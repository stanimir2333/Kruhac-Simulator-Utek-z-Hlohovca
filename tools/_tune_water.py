"""Jemnejšia voda v animácii kollar.html — svetlejšie hlboké a plytké odtiene."""
p = 'kollar.html'
s = open(p, encoding='utf-8').read()
subs = [
    ("deep: 0x1e2c33, shal: 0x35474a", "deep: 0x2a3a42, shal: 0x45595c"),
    ("deep: 0x1c333c, shal: 0x3a6a68", "deep: 0x28505a, shal: 0x4a8880"),
    ("deep: 0x1d3a44, shal: 0x3f7a74", "deep: 0x2a5560, shal: 0x4f9184"),
    ("deep: 0x20383c, shal: 0x466f66", "deep: 0x2d4f4c, shal: 0x568472"),
    ("deep: 0x2a3a3c, shal: 0x4e7a6a", "deep: 0x354a42, shal: 0x5f8d72"),
    ("deep: 0x2c3038, shal: 0x6a6a54", "deep: 0x3c3d3a, shal: 0x7a7a5e"),
    ("deep: 0x35302c, shal: 0x7a5c3a", "deep: 0x3f362e, shal: 0x8c6842"),
    ("deep: 0x2a2226, shal: 0x6a4230", "deep: 0x362c2c, shal: 0x7c4c38"),
    ("deep: 0x0e1428, shal: 0x2a3a60", "deep: 0x18213c, shal: 0x3a4c78"),
]
for a, b in subs:
    if a not in s:
        print("NENASIEL:", a)
    s = s.replace(a, b)
open(p, 'w', encoding='utf-8').write(s)
print("hotovo")
