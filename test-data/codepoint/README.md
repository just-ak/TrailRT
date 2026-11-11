# Code-Point Open excerpt

A small excerpt of Ordnance Survey **Code-Point Open**, release 2026-11
(copyright date 19 October 2026), used by the postcode tests (Phase 10
Requirements 13.9 and 13.11). The rows are copied unchanged from the release,
not invented.

Contains OS data © Crown copyright and database right 2026.
Contains Royal Mail data © Royal Mail copyright and database right 2026.
Contains National Statistics data © Crown copyright and database right 2026.

Published under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
`Doc/licence.txt` and `Doc/metadata.txt` are the release's own files, copied
byte for byte (the licence file is Latin-1).

## What is here

The same layout as the release's ZIP, so a test can zip this folder and feed
it to the real ingest:

| File | Rows | Why |
| --- | --- | --- |
| `Data/CSV/sk.csv` | 274 | The whole `SK17 6` sector: central Buxton |
| `Data/CSV/de.csv` | 1 | `DE6 1AA`, Ashbourne |
| `Data/CSV/tr.csv` | 1 | `TR18 2AA`, Penzance: the far south-west of the grid |
| `Data/CSV/kw.csv` | 1 | `KW1 4AA`, Wick: the far north |
| `Data/CSV/ab.csv` | 2 | `AB43 1AJ` and `AB43 1AN`: positional quality 90, coordinates 0, 0 |

Quality 90 means the postcode exists but the release has no location for it.
The ingest must store it as a postcode with no location, not plot it at 0, 0.
The release has 888 such postcodes.

## Source

`https://api.os.uk/downloads/v1/products/CodePointOpen/downloads?area=GB&format=CSV&redirect`,
`codepo_gb.zip`, 14,470,875 bytes, MD5 `4c0935d67129402dd0719e063676d9ae`,
downloaded 10 November 2026.
