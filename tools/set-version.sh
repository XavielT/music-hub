#!/usr/bin/env bash
# Set the Music Hub version in the three places that must agree.
#
# The in-app updater compares the running version against the latest GitHub
# release tag, so a version that is only bumped in some of these files means
# the app either nags forever or never notices an update at all:
#
#   package.json                  the npm version
#   src/version.ts                what the web build reports
#   android/app/build.gradle      versionName, plus versionCode +1 (Android
#                                 refuses to install an APK whose versionCode
#                                 is not higher than the installed one)
#
#   ./tools/set-version.sh 0.3.0
#
# Then commit, tag `v0.3.0`, build the signed APK and attach it to a GitHub
# release of that tag as `music-hub.apk` — that filename is what the updater
# looks for.
set -euo pipefail

VERSION="${1:-}"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 <version>   e.g. $0 0.3.0" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

CURRENT=$(node -p "require('./package.json').version")
if [ "$VERSION" = "$CURRENT" ]; then
  echo "Already at $VERSION." >&2
  exit 1
fi

GRADLE=android/app/build.gradle
CODE=$(grep -oP 'versionCode\s+\K[0-9]+' "$GRADLE")
NEXT_CODE=$((CODE + 1))

node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.version = process.argv[1];
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
' "$VERSION"

sed -i "s/^export const APP_VERSION = '.*';$/export const APP_VERSION = '$VERSION';/" src/version.ts
sed -i "s/versionCode $CODE/versionCode $NEXT_CODE/" "$GRADLE"
sed -i "s/versionName \".*\"/versionName \"$VERSION\"/" "$GRADLE"

echo "$CURRENT -> $VERSION (Android versionCode $CODE -> $NEXT_CODE)"
grep -n "APP_VERSION" src/version.ts
grep -n "versionCode\|versionName" "$GRADLE"
echo
echo "Next:"
echo "  git commit -am \"chore: release $VERSION\" && git tag v$VERSION"
echo "  npm run build && npx cap sync android"
echo "  (cd android && ./gradlew assembleRelease)"
echo "  Attach android/app/build/outputs/apk/release/app-release.apk to the"
echo "  v$VERSION GitHub release, renamed to music-hub.apk."
