# Karakter sheet pózok — pontos lista + újrafelhasználható prompt

## 1. Hány póz van pontosan egy karakterhez?

A játék jelenleg **5 külön "sheet-csoportra"** bontja a pózokat (ezek külön konstansok a kódban, tehát eddig is külön képfájlokból lettek kivágva). Karakterenként ennyi:

### A) Alap harci sheet — 10 póz (ugyanez van meg "Berserk" alt-art verzióban is, lásd C pont)
1. `idle` — nyugalmi állás
2. `walk` — séta
3. `run` — futás
4. `jump` — ugrás (levegőben)
5. `block` — védekezés (állva)
6. `punch` — ütés (ökölcsapás)
7. `kick` — rúgás
8. `hit` — találat éri / hátratántorodás
9. `win` — győzelmi póz
10. `lose` — vereség póz

### B) Combat System 2.0 sheet — 6 póz (nincs külön Berserk verziója, mindig ugyanaz)
1. `sweep` — seprő rúgás (alacsony)
2. `throw` — dobás indítása (megragadás)
3. `beingThrown` — ELDOBOTT fél pózja (repülés dobás közben)
4. `knockdown` — földön fekve
5. `getUp` — felkelés
6. `crouch` — guggolás

### C) Berserk (Special) sheet — **ugyanaz a 10 póz, mint az A) pont**, csak más grafikai stílusban/kinézetben (pl. dühösebb arc, más effekt) — ÚJ pózt nem kell kitalálni, csak ugyanazt a 10-et újrarajzoltatni "berserk módban".

### D) Enter (bevonulás) sheet — karakterenként eltérő
- Krisz: **5 póz** (enter1–enter5)
- Tomi: **5 póz** (enter1–enter5)
- Laci: **4 póz** (enter1–enter4)

### E) Ultimate sheet — karakterenként eltérő
- Krisz: **10 póz** (ult1–ult10)
- Tomi: **7 póz** (ult1–ult7)
- Laci: **9 póz** (ult1–ult9)

### Összesen (minden sheet együtt)
| Karakter | A) Alap | B) Combat2 | C) Berserk | D) Enter | E) Ultimate | **Össz. rajzolt póz** |
|---|---|---|---|---|---|---|
| Krisz | 10 | 6 | 10 | 5 | 10 | **41** |
| Tomi | 10 | 6 | 10 | 5 | 7 | **38** |
| Laci | 10 | 6 | 10 | 4 | 9 | **39** |

Tehát valóban jóval több, mint 20 — ha mindent (Berserk + Ultimate + Enter is) egységesíteni akarsz, karakterenként ~38–41 pózról beszélünk, 5 külön sheet-ben. A jó hír: nem kell egy menetben mindet megcsináltatni — pont az 5 kategória (A–E) adja magától az 5 különálló generálási kört, mert ezek amúgy is eltérő stílusú/kontextusú képek (pl. az Ultimate egy teljesen más jelenet, mint az alap harci pózok).

---

## 2. Az újrafelhasználható "karakter bibliája"

Ezt írd meg **egyszer, karakterenként**, és utána minden promptba illeszd be szó szerint (ne írd újra, csak másold be):

```
KARAKTER LEÍRÁS (rögzített, mindig ugyanaz):
[Karakter neve]: [kor], [testalkat/magasság], [hajszín és frizura pontosan],
[arcszőrzet ha van], [bőrszín], [pontos ruházat felülről lefelé: felső,
alsó, cipő — színek és típusok], [kiegészítők: szemüveg, óra, ékszer stb.],
[egyedi jegyek: tetoválás, forradás, jellegzetes tárgy amit gyakran tart].

STÍLUS (rögzített, mindig ugyanaz):
Lapos színezésű ("flat shading"), vastag fekete körvonal, 2D fighting
game sprite stílus, nincs árnyékolás/gradient, egységes vonalvastagság,
egységes proporciók (fej:test arány mindig ugyanaz).
```

---

## 3. Master prompt sablon (ezt másold be a ChatGPT-nek minden alkalommal)

```
Használd ugyanazt a karaktert, amit korábban meghatároztunk / amit a
csatolt referenciaképen látsz — NE változtass a design részletein
(arc, haj, ruha, színek, testalkat), csak a pózt/testtartást változtasd.

[ide illeszd be a "KARAKTER LEÍRÁS" + "STÍLUS" blokkot a 2. pontból]

Készíts EGY képet, rács elrendezésben (grid), amely a következő
pózokat tartalmazza, balról jobbra, egyenlő méretű cellákban,
egységes (semleges, egyszínű, pl. világosszürke) háttérrel,
egységes megvilágítással, egységes karaktermérettel minden cellában:

1. [póz neve + rövid leírás]
2. [póz neve + rövid leírás]
...

Minden pózban a karakter pontosan ugyanúgy nézzen ki (frizura, ruha,
színek, testalkat) — kizárólag a testtartás/póz változzon.
```

**Egy konkrét, kitöltött példa (Krisz, A) Alap sheet, 10 póz):**

```
Használd ugyanazt a karaktert, amit korábban meghatároztunk / amit a
csatolt referenciaképen látsz — NE változtass a design részletein
(arc, haj, ruha, színek, testalkat), csak a pózt/testtartást változtasd.

KARAKTER: Krisz — fiatal felnőtt férfi, átlagos testalkat, rövid barna
haj, [...ide a te pontos leírásod...]. Stílus: lapos színezés, vastag
fekete körvonal, 2D fighting game sprite, nincs árnyékolás.

Készíts EGY képet, rács elrendezésben (grid, 5 oszlop x 2 sor),
amely a következő 10 pózt tartalmazza, egyenlő méretű cellákban,
egységes világosszürke háttérrel, egységes megvilágítással:

1. idle — nyugodt alapállás, kezek lazán
2. walk — séta közben, egyik láb elöl
3. run — futás, dinamikus testhelyzet
4. jump — ugrás, mindkét láb elemelve a talajtól
5. block — védekező testtartás, karok felhúzva védésre
6. punch – ökölcsapás kinyújtott karral
7. kick — rúgás, egyik láb magasan
8. hit — találat érte, hátratántorodó testhelyzet
9. win — győzelmi póz, magabiztos testtartás
10. lose — vereség, összeroskadt testhelyzet

Minden pózban a karakter pontosan ugyanúgy nézzen ki — kizárólag a
testtartás változzon.
```

**Fontos gyakorlati tippek:**
- Mindig csatolj referenciaképet (egy korábbi, jónak ítélt sheet-ből kivágott egy pózt), ne csak szövegből dolgoztasd.
- Egy generálásban kérd az ÖSSZES pózt egy adott sheet-kategóriából (A, B, C, D vagy E) — ne pózonként külön kérj képet.
- Ha egy sheet nem jó, ne az egészet generáltasd újra: kérd meg, hogy "ugyanezt a képet, csak cseréld ki a 4. cellát erre: [...]" — így a többi póz nem csúszik el.
- A Berserk (C) sheet-hez ugyanezt a promptot használd, csak fűzd hozzá: "ugyanaz a karakter és ugyanaz a 10 póz, de 'berserk' / dühöngő módban: [ide írd le mi változzon — pl. vöröses izzás, vicsorgó arc, feszesebb testtartás]".
```
