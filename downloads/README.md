# Move Out of Quarantine

Until I get my MacOS notarization, you will need to remove the quarantine attribute from the app bundle after downloading it. You can do this by running the following command in your terminal:

```
xattr -dr com.apple.quarantine "/Applications/TrailRT.app"
```
