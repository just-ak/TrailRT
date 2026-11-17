TrailRT {{VERSION}} for Macs with Apple silicon (M1 or later), macOS 13.3 or later. Intel Macs are not supported.

## Install

1. Download **{{FILE}}** below, open it, and drag TrailRT into Applications.
2. There is no Apple Developer ID for TrailRT yet, so the app is ad-hoc signed rather than notarised, and macOS blocks it the first time. Try to open TrailRT once, then open **System Settings → Privacy & Security**, find the line naming TrailRT, click **Open Anyway** and authenticate. It opens normally from then on.

Please do not turn Gatekeeper off for your whole Mac to get round this.

## First time

Road routing and postcode search work offline once their data is downloaded. The [first-time setup guide](https://github.com/just-ak/TrailRT/blob/main/downloads/README.md) shows how to choose your map regions and get postcode data.

## Check the download

The SHA-256 of {{FILE}} is in {{FILE}}.sha256, attached below. With both in the same folder:

```
shasum -a 256 -c {{FILE}}.sha256
```

## Source

The source this DMG was built from is attached below as zip and tar.gz, and is the tag of this release. See `LICENSE` in it.
