"""Vytiahne modulový skript z kollar.html na kontrolu typov (deno check)."""
import re
import sys

src = open('kollar.html', encoding='utf-8').read()
m = re.search(r'<script type="module">(.*?)</script>', src, re.S)
if not m:
    sys.exit('modulovy skript sa nenasiel')
code = m.group(1)
code = code.replace("await import('three')",
                    "await import('./node_modules/three/build/three.module.js')")
open('_kollar_check.mjs', 'w', encoding='utf-8').write(code)
print('dĺžka kódu:', len(code))
