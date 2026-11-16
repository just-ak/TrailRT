// SPDX-License-Identifier: MIT
// Copyright (C) 2026 TrailRT contributors
//
// trailrt-osm: the OpenStreetMap extract tool TrailRT bundles beside Valhalla.
//
// It replaces the osmium-tool executable (ADR 0023). Everything it does is
// built on libosmium (BSL-1.0) and protozero (BSD-2-Clause), both header-only,
// so the only code compiled in is this file and those permissive libraries.
//
//   trailrt-osm merge OUTPUT INPUT...      sorted extracts -> one sorted file
//   trailrt-osm data-date INPUT            the extract's replication timestamp
//   trailrt-osm places INPUT OUTPUT EXPR...  place data as GeoJSON lines
//   trailrt-osm version
//
// Exit status: 0 success, 1 failure (message on stderr), 2 usage error.

#include <osmium/area/assembler.hpp>
#include <osmium/geom/geojson.hpp>
#include <osmium/handler.hpp>
#include <osmium/io/input_iterator.hpp>
#include <osmium/io/pbf_input.hpp>
#include <osmium/io/pbf_output.hpp>
#include <osmium/io/reader.hpp>
#include <osmium/io/writer.hpp>
#include <osmium/io/xml_input.hpp>
#include <osmium/memory/buffer.hpp>
#include <osmium/osm/area.hpp>
#include <osmium/osm/node.hpp>
#include <osmium/osm/relation.hpp>
#include <osmium/osm/way.hpp>
#include <osmium/relations/relations_manager.hpp>
#include <osmium/tags/matcher.hpp>
#include <osmium/tags/tags_filter.hpp>
#include <osmium/tags/taglist.hpp>
#include <osmium/util/string_matcher.hpp>
#include <osmium/version.hpp>
#include <osmium/visitor.hpp>

#include <algorithm>
#include <cerrno>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <exception>
#include <memory>
#include <queue>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

constexpr const char* kVersion = "1.0.0";

[[noreturn]] void usage() {
    std::fputs(
        "usage:\n"
        "  trailrt-osm merge OUTPUT INPUT...\n"
        "  trailrt-osm data-date INPUT\n"
        "  trailrt-osm places INPUT OUTPUT EXPRESSION...\n"
        "  trailrt-osm version\n",
        stderr);
    std::exit(2);
}

// ---------------------------------------------------------------- merge
//
// Geofabrik's regions overlap their neighbours, and Valhalla aborts on
// overlapping extracts (ADR 0018). Each input is sorted by type, then id, then
// version, so a k-way merge yields one sorted file. Where several inputs carry
// the same object, only its newest version is written: two counties downloaded
// on different days can disagree, and Valhalla must see each id once.

struct Source {
    using iterator = osmium::io::InputIterator<osmium::io::Reader, osmium::OSMObject>;

    std::string name;
    std::unique_ptr<osmium::io::Reader> reader;
    iterator it;
    iterator end;

    // Identity of the last object taken, to prove the input is sorted.
    bool started = false;
    osmium::item_type last_type = osmium::item_type::undefined;
    osmium::object_id_type last_id = 0;
    osmium::object_version_type last_version = 0;

    explicit Source(const std::string& path) :
        name(path),
        reader(std::make_unique<osmium::io::Reader>(osmium::io::File{path}, osmium::osm_entity_bits::nwr)),
        it(*reader),
        end() {
    }

    bool done() const { return it == end; }
    const osmium::OSMObject& current() const { return *it; }
};

// Same order as libosmium's operator< for objects, without the timestamp.
bool before(osmium::item_type at, osmium::object_id_type aid, osmium::object_version_type av,
            osmium::item_type bt, osmium::object_id_type bid, osmium::object_version_type bv) {
    const auto ka = std::make_tuple(at, aid > 0, aid < 0 ? -aid : aid, av);
    const auto kb = std::make_tuple(bt, bid > 0, bid < 0 ? -bid : bid, bv);
    return ka < kb;
}

struct LaterFirst {
    bool operator()(const Source* a, const Source* b) const {
        // std::priority_queue keeps the *largest* on top; we want the smallest.
        return b->current() < a->current();
    }
};

int merge(const std::string& output, const std::vector<std::string>& inputs) {
    std::vector<std::unique_ptr<Source>> sources;
    std::priority_queue<Source*, std::vector<Source*>, LaterFirst> queue;
    for (const auto& input : inputs) {
        sources.push_back(std::make_unique<Source>(input));
        if (!sources.back()->done()) queue.push(sources.back().get());
    }

    osmium::io::Header header;
    header.set("generator", std::string{"trailrt-osm/"} + kVersion);
    osmium::io::Writer writer{osmium::io::File{output}, header, osmium::io::overwrite::allow};

    // The object waiting to be written, held until we know no newer version of
    // it follows. A copy, because its source buffer may be released on advance.
    osmium::memory::Buffer pending{1024 * 64, osmium::memory::Buffer::auto_grow::yes};
    bool have_pending = false;

    while (!queue.empty()) {
        Source* source = queue.top();
        queue.pop();
        const osmium::OSMObject& object = source->current();

        if (source->started && before(object.type(), object.id(), object.version(), source->last_type,
                                      source->last_id, source->last_version)) {
            throw std::runtime_error{"input is not sorted: " + source->name +
                                     " (sort it first; Geofabrik extracts are sorted)"};
        }
        source->started = true;
        source->last_type = object.type();
        source->last_id = object.id();
        source->last_version = object.version();

        if (have_pending) {
            const auto& held = pending.get<osmium::OSMObject>(0);
            if (held.type() != object.type() || held.id() != object.id()) {
                writer(held);
            }
            // Same object: the one arriving now is the same version or newer.
            pending.clear();
        }
        pending.add_item(object);
        pending.commit();
        have_pending = true;

        ++source->it;
        if (!source->done()) queue.push(source);
    }
    if (have_pending) writer(pending.get<osmium::OSMObject>(0));

    writer.close();
    for (auto& source : sources) source->reader->close();
    return 0;
}

// ------------------------------------------------------------ data-date

int data_date(const std::string& input) {
    osmium::io::Reader reader{osmium::io::File{input}, osmium::osm_entity_bits::nothing};
    const std::string value = reader.header().get("osmosis_replication_timestamp");
    reader.close();
    std::printf("%s\n", value.c_str());
    return 0;
}

// --------------------------------------------------------------- places
//
// The subset of osmium-tool's tags-filter expression syntax that TrailRT
// generates (src/shared/poi/categories.ts, src/main/places/extract.ts):
//
//   [nwr]/key            any object of those types with the key
//   [nwr]/key=v1,v2,...  ...whose value is one of the listed values
//
// Anything else is refused rather than guessed at, so a new expression form
// fails loudly in the integration test instead of silently matching nothing.

struct Filters {
    osmium::TagsFilter node{false};
    osmium::TagsFilter way{false};
    osmium::TagsFilter relation{false};
};

void add_expression(Filters& filters, const std::string& expression) {
    const auto slash = expression.find('/');
    if (slash == std::string::npos || slash == 0) {
        throw std::invalid_argument{"expression needs a type prefix such as nwr/: " + expression};
    }
    const std::string types = expression.substr(0, slash);
    const std::string rest = expression.substr(slash + 1);
    if (types.find_first_not_of("nwr") != std::string::npos) {
        throw std::invalid_argument{"unknown object type in: " + expression};
    }
    if (rest.empty() || rest.find_first_of("*!~") != std::string::npos) {
        throw std::invalid_argument{"unsupported expression: " + expression};
    }

    const auto equals = rest.find('=');
    osmium::TagMatcher matcher;
    if (equals == std::string::npos) {
        matcher = osmium::TagMatcher{osmium::StringMatcher::equal{rest}};
    } else {
        const std::string key = rest.substr(0, equals);
        std::vector<std::string> values;
        std::string::size_type start = equals + 1;
        while (start <= rest.size()) {
            const auto comma = rest.find(',', start);
            const auto stop = comma == std::string::npos ? rest.size() : comma;
            if (stop == start) throw std::invalid_argument{"empty value in: " + expression};
            values.push_back(rest.substr(start, stop - start));
            start = stop + 1;
        }
        if (key.empty()) throw std::invalid_argument{"empty key in: " + expression};
        matcher = osmium::TagMatcher{osmium::StringMatcher::equal{key},
                                     osmium::StringMatcher::list{std::move(values)}};
    }

    if (types.find('n') != std::string::npos) filters.node.add_rule(true, matcher);
    if (types.find('w') != std::string::npos) filters.way.add_rule(true, matcher);
    if (types.find('r') != std::string::npos) filters.relation.add_rule(true, matcher);
}

bool sorted_contains(const std::vector<std::uint64_t>& ids, std::uint64_t id) {
    return std::binary_search(ids.begin(), ids.end(), id);
}

void sort_unique(std::vector<std::uint64_t>& ids) {
    std::sort(ids.begin(), ids.end());
    ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
}

// Areas from matching closed ways and matching multipolygon relations. Like
// libosmium's MultipolygonManager, except that ways and relations are tested
// against their own filters: `w/highway` must not make a highway relation an
// area, just as `osmium tags-filter` would not have selected one.
class AreaManager
    : public osmium::relations::RelationsManager<AreaManager, false, true, false> {
    osmium::area::Assembler::config_type m_config;
    const Filters& m_filters;

public:
    AreaManager(const osmium::area::Assembler::config_type& config, const Filters& filters) :
        m_config(config),
        m_filters(filters) {
    }

    bool new_relation(const osmium::Relation& relation) const {
        const char* type = relation.tags().get_value_by_key("type");
        if (type == nullptr) return false;
        if (std::strcmp(type, "multipolygon") != 0 && std::strcmp(type, "boundary") != 0) return false;
        if (!osmium::tags::match_any_of(relation.tags(), m_filters.relation)) return false;
        return std::any_of(relation.members().cbegin(), relation.members().cend(),
                           [](const osmium::RelationMember& m) { return m.type() == osmium::item_type::way; });
    }

    void complete_relation(const osmium::Relation& relation) {
        std::vector<const osmium::Way*> ways;
        ways.reserve(relation.members().size());
        for (const auto& member : relation.members()) {
            if (member.ref() != 0) ways.push_back(this->get_member_way(member.ref()));
        }
        try {
            osmium::area::Assembler assembler{m_config};
            assembler(relation, ways, this->buffer());
        } catch (const osmium::invalid_location&) {
            // A member way runs outside the extract: no area, as osmium export.
        }
    }

    void after_way(const osmium::Way& way) {
        if (way.nodes().size() <= 3) return;
        if (!way.nodes().front().location() || !way.nodes().back().location()) return;
        if (!way.ends_have_same_location()) return;
        if (way.tags().has_tag("area", "no")) return;
        if (!osmium::tags::match_any_of(way.tags(), m_filters.way)) return;
        try {
            osmium::area::Assembler assembler{m_config};
            assembler(way, this->buffer());
            this->possibly_flush();
        } catch (const osmium::invalid_location&) {
        }
    }
};

// Locations for the nodes the places output needs, and no others. Ids and
// locations sit in two parallel vectors: 16 bytes a node, against an index of
// every node in the extract.
class Locations : public osmium::handler::Handler {
    const std::vector<std::uint64_t>& m_ids;
    std::vector<osmium::Location> m_locations;

    std::size_t index_of(std::uint64_t id) const {
        const auto it = std::lower_bound(m_ids.begin(), m_ids.end(), id);
        return (it != m_ids.end() && *it == id) ? static_cast<std::size_t>(it - m_ids.begin()) : m_ids.size();
    }

public:
    explicit Locations(const std::vector<std::uint64_t>& ids) : m_ids(ids), m_locations(ids.size()) {}

    void node(const osmium::Node& node) {
        const auto i = index_of(node.positive_id());
        if (i < m_ids.size()) m_locations[i] = node.location();
    }

    void way(osmium::Way& way) {
        for (auto& ref : way.nodes()) {
            const auto i = index_of(ref.positive_ref());
            ref.set_location(i < m_ids.size() ? m_locations[i] : osmium::Location{});
        }
    }
};

void append_json_string(std::string& out, const char* s) {
    out += '"';
    for (const char* p = s; *p != '\0'; ++p) {
        const auto c = static_cast<unsigned char>(*p);
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    char escaped[8];
                    std::snprintf(escaped, sizeof escaped, "\\u%04x", c);
                    out += escaped;
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    out += '"';
}

// Writes one GeoJSON feature per line, in the shape `osmium export -f
// geojsonseq -a type,id` produced, so the ingest reads it unchanged: `@type`
// and `@id` first, then the tags. Like osmium export, a closed way is written
// both as a LineString and, when it assembles, as a MultiPolygon; the ingest
// keys by type/id and lets the area win.
class Exporter : public osmium::handler::Handler {
    const Filters& m_filters;
    std::FILE* m_out;
    osmium::geom::GeoJSONFactory<> m_factory;
    std::string m_line;
    std::uint64_t m_count = 0;

    void write(const char* type, osmium::object_id_type id, const std::string& geometry,
               const osmium::TagList& tags) {
        m_line.clear();
        m_line += R"({"type":"Feature","geometry":)";
        m_line += geometry;
        m_line += R"(,"properties":{"@type":")";
        m_line += type;
        m_line += R"(","@id":)";
        m_line += std::to_string(id);
        for (const auto& tag : tags) {
            m_line += ',';
            append_json_string(m_line, tag.key());
            m_line += ':';
            append_json_string(m_line, tag.value());
        }
        m_line += "}}\n";
        if (std::fwrite(m_line.data(), 1, m_line.size(), m_out) != m_line.size()) {
            throw std::runtime_error{std::string{"cannot write output: "} + std::strerror(errno)};
        }
        ++m_count;
    }

public:
    Exporter(const Filters& filters, std::FILE* out) : m_filters(filters), m_out(out) {}

    std::uint64_t count() const { return m_count; }

    void node(const osmium::Node& node) {
        if (!osmium::tags::match_any_of(node.tags(), m_filters.node)) return;
        if (!node.location().valid()) return;
        write("node", node.id(), m_factory.create_point(node), node.tags());
    }

    void way(const osmium::Way& way) {
        if (!osmium::tags::match_any_of(way.tags(), m_filters.way)) return;
        // A closed way tagged area=yes is an area only, never a line, as in
        // osmium export: a pedestrian square is not a street.
        if (way.ends_have_same_id() && way.tags().has_tag("area", "yes")) return;
        std::string geometry;
        try {
            geometry = m_factory.create_linestring(way);
        } catch (const osmium::geometry_error&) {
            return;
        } catch (const osmium::invalid_location&) {
            return;
        }
        write("way", way.id(), geometry, way.tags());
    }

    void area(const osmium::Area& area) {
        std::string geometry;
        try {
            geometry = m_factory.create_multipolygon(area);
        } catch (const osmium::geometry_error&) {
            return;
        } catch (const osmium::invalid_location&) {
            return;
        }
        write(area.from_way() ? "way" : "relation", area.orig_id(), geometry, area.tags());
    }
};

int places(const std::string& input, const std::string& output, const std::vector<std::string>& expressions) {
    Filters filters;
    for (const auto& expression : expressions) add_expression(filters, expression);

    const osmium::io::File file{input};
    osmium::area::Assembler::config_type config;
    AreaManager areas{config, filters};

    // Pass 1, relations: which multipolygons to build, and their member ways.
    std::vector<std::uint64_t> member_ways;
    {
        osmium::io::Reader reader{file, osmium::osm_entity_bits::relation};
        while (osmium::memory::Buffer buffer = reader.read()) {
            for (const auto& relation : buffer.select<osmium::Relation>()) {
                areas.relation(relation);
                if (!areas.new_relation(relation)) continue;
                for (const auto& member : relation.members()) {
                    if (member.type() == osmium::item_type::way) {
                        member_ways.push_back(static_cast<std::uint64_t>(member.positive_ref()));
                    }
                }
            }
        }
        reader.close();
        areas.prepare_for_lookup();
        sort_unique(member_ways);
    }

    // Pass 2, ways: the nodes whose locations the output needs.
    std::vector<std::uint64_t> needed;
    {
        osmium::io::Reader reader{file, osmium::osm_entity_bits::way};
        while (osmium::memory::Buffer buffer = reader.read()) {
            for (const auto& way : buffer.select<osmium::Way>()) {
                if (!osmium::tags::match_any_of(way.tags(), filters.way) &&
                    !sorted_contains(member_ways, way.positive_id())) {
                    continue;
                }
                for (const auto& ref : way.nodes()) needed.push_back(ref.positive_ref());
            }
        }
        reader.close();
        sort_unique(needed);
    }

    // Pass 3, nodes and ways: locate, export, and assemble areas.
    std::FILE* out = std::fopen(output.c_str(), "wb");
    if (out == nullptr) {
        throw std::runtime_error{"cannot open " + output + ": " + std::strerror(errno)};
    }
    std::unique_ptr<std::FILE, int (*)(std::FILE*)> closer{out, &std::fclose};
    static char out_buffer[1 << 20];
    std::setvbuf(out, out_buffer, _IOFBF, sizeof out_buffer);

    Locations locations{needed};
    Exporter exporter{filters, out};
    {
        osmium::io::Reader reader{file, osmium::osm_entity_bits::node | osmium::osm_entity_bits::way};
        osmium::apply(reader, locations, exporter, areas.handler([&exporter](osmium::memory::Buffer&& buffer) {
            osmium::apply(buffer, exporter);
        }));
        reader.close();
    }

    if (std::fflush(out) != 0) {
        throw std::runtime_error{std::string{"cannot write output: "} + std::strerror(errno)};
    }
    std::fprintf(stderr, "trailrt-osm: %llu features\n", static_cast<unsigned long long>(exporter.count()));
    return 0;
}

} // namespace

int main(int argc, char* argv[]) {
    if (argc < 2) usage();
    const std::string command = argv[1];
    std::vector<std::string> args(argv + 2, argv + argc);

    try {
        if (command == "merge") {
            if (args.size() < 2) usage();
            return merge(args[0], std::vector<std::string>(args.begin() + 1, args.end()));
        }
        if (command == "data-date") {
            if (args.size() != 1) usage();
            return data_date(args[0]);
        }
        if (command == "places") {
            if (args.size() < 3) usage();
            return places(args[0], args[1], std::vector<std::string>(args.begin() + 2, args.end()));
        }
        if (command == "version") {
            std::printf("trailrt-osm %s (libosmium %s)\n", kVersion, LIBOSMIUM_VERSION_STRING);
            return 0;
        }
        usage();
    } catch (const std::invalid_argument& error) {
        std::fprintf(stderr, "trailrt-osm %s: %s\n", command.c_str(), error.what());
        return 2;
    } catch (const std::exception& error) {
        std::fprintf(stderr, "trailrt-osm %s: %s\n", command.c_str(), error.what());
        return 1;
    }
}
