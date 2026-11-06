#!/usr/bin/env bash
# Køyr før kvar commit: skriv ein ny versjon inn i index.html og versjon.txt.
# Appen samanliknar dei når du drar ned / trykkjer Oppdater, og hentar ny versjon utan omstart.
set -euo pipefail
cd "$(dirname "$0")"
V=$(grep -v 'name="onskje-versjon"' index.html | cat - sw.js manifest.webmanifest | sha1sum | cut -c1-12)
sed -i "s/<meta name=\"onskje-versjon\" content=\"[^\"]*\">/<meta name=\"onskje-versjon\" content=\"$V\">/" index.html
printf '%s\n' "$V" > versjon.txt
echo "Versjon $V"
