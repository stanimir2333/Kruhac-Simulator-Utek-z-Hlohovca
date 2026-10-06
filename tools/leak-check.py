#!/usr/bin/env python3
"""tools/leak-check.py — overí, že portované moduly nemajú nedefinované identifikátory."""
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORLD = ROOT / "src" / "world"
STR = re.compile(r'`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*.*?\*/', re.S)
KEYWORDS = {'break','case','catch','class','const','continue','debugger','default','delete','do',
 'else','export','extends','finally','for','from','function','if','import','in','instanceof','let',
 'new','of','return','static','super','switch','this','throw','try','typeof','var','void','while',
 'with','yield','async','await','as','get','set','true','false','null','undefined','NaN','Infinity'}
BUILTINS = {'Math','JSON','Object','Array','Number','String','Boolean','parseInt','parseFloat',
 'isNaN','isFinite','Map','Set','WeakMap','Error','Float32Array','Float64Array','Uint8Array',
 'Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array','ArrayBuffer','DataView',
 'THREE','document','window','performance','requestAnimationFrame','cancelAnimationFrame','console',
 'localStorage','location','addEventListener','removeEventListener','setTimeout','clearTimeout',
 'setInterval','clearInterval','innerWidth','innerHeight','devicePixelRatio','navigator','fetch',
 'TextDecoder','Image','Audio','URL','Blob','Promise','S'}
SKIP = {'shared.js'}
NAMES = re.compile(r'[A-Za-z_$][\w$]*')

def strip_types(src):
    return src

def defined_in(src):
    code = STR.sub('', src)
    defs = set()
    # všetky deklarátory: rozsekni čiarky na top-leveli každého let/const/var statementu
    for m in re.finditer(r'(?:let|const|var)\s+', code):
        i, depth, cur, instr = m.end(), 0, '', None
        names = []
        while i < len(code):
            ch = code[i]
            if instr:
                if ch == instr: instr = None
            elif ch in '"\'`': instr = ch
            elif ch in '([{': depth += 1
            elif ch in ')]}': depth -= 1
            elif ch == ';' and depth == 0: break
            i += 1
        decl = code[m.end():i]
        # mená pred = , : (destruct) a holé
        for nm in re.finditer(r'([A-Za-z_$][\w$]*)', decl):
            w = nm.group(1)
            # vezmi len "kľúčové" pozície: začiatok, za čiarkou/{/[
            pre = decl[:nm.start()].rstrip()
            if pre == '' or pre[-1] in ',{[':
                defs.add(w)
    defs |= set(re.findall(r'function\*?\s+([A-Za-z_$][\w$]*)', code))
    defs |= set(re.findall(r'([A-Za-z_$][\w$]*)\s*=>', code))
    for m in re.finditer(r'import\s+(?:\*\s+as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\}|([A-Za-z_$][\w$]*))', code):
        if m.group(1): defs.add(m.group(1))
        if m.group(2):
            for p in m.group(2).split(','):
                p = p.strip().split(' as ')[-1].strip()
                if re.match(r'^[A-Za-z_$][\w$]*$', p): defs.add(p)
        if m.group(3): defs.add(m.group(3))
    for fm in re.finditer(r'function\s*\w*\(([^)]*)\)', code):
        for p in fm.group(1).split(','):
            for q in re.split(r'[{},\s:\[\]=]+', p.strip()):
                if re.match(r'^[A-Za-z_$][\w$]*$', q): defs.add(q)
    for am in re.finditer(r'\(([^()]*)\)\s*=>', code):
        for p in am.group(1).split(','):
            for q in re.split(r'[{},\s:\[\]=]+', p.strip()):
                if re.match(r'^[A-Za-z_$][\w$]*$', q): defs.add(q)
    for lb in re.finditer(r'(?:^|[;{}])\s*([A-Za-z_$][\w$]*)\s*:\s*(?:for|while|do)\b', code):
        defs.add(lb.group(1))
    for cm in re.finditer(r'catch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)', code): defs.add(cm.group(1))
    for fm in re.finditer(r'for\s*\(\s*(?:let|const|var)?\s*([A-Za-z_$][\w$]*)', code): defs.add(fm.group(1))
    return defs

def used_in(src):
    code = STR.sub('', src)
    out = set()
    for m in re.finditer(r'(?<![.\w$])([A-Za-z_$][\w$]*)', code):
        w = m.group(1)
        if w in KEYWORDS: continue
        rest = code[m.end():]
        rm = re.match(r'\s*:', rest)
        if rm:
            # object key? predchádza { , alebo začiatok riadka
            pre = code[:m.start()].rstrip()
            if not pre or pre[-1] in '{,[':
                continue
            if pre[-1] == '?':
                pass  # ternary consequent — skutočné použitie
            else:
                # label alebo key — preskoč
                if pre[-1] not in ('?', ')'):
                    continue
        out.add(w)
    return out

def main():
    fails = 0
    for f in sorted(WORLD.glob('*.js')):
        if f.name in SKIP: continue
        src = f.read_text(encoding='utf-8')
        leaks = sorted(used_in(src) - defined_in(src) - BUILTINS)
        if leaks:
            fails += 1
            print(f"{f.name}: LEAK {leaks}")
        else:
            print(f"{f.name}: OK")
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
