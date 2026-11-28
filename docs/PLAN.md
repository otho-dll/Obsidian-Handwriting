# Plan: bryły 3D, układ edytora obwodów, nazwy serii, menu i rysik, haptyka, pomysły

## Kontekst
Wtyczka przesuwa się w stronę narzędzia dla inżynierów. Pierwszym krokiem był edytor obwodów ([src/circuit/](src/circuit/)), który wstawia wynik jako zwykłe kreski pióra ([src/view/circuitInsert.ts](src/view/circuitInsert.ts)). Teraz trzy rzeczy:
1. Wstawianie brył (sześcian, prostopadłościan, walec, kula, pierścień itd.), z wyborem rzutu i sposobu pokazywania krawędzi niewidocznych.
2. Okno „Insert circuit” na pionowym tablecie: plansza 4:3 ma stałą wysokość `46vh`, jest przyklejona do góry, a pod nią zostaje dużo pustego miejsca ([src/styles.css:1254-1262](src/styles.css#L1254-L1262)).
3. Pomysły na dalszy rozwój (tylko lista, nic nie implementuję, na końcu pliku).

Decyzje użytkownika: (a) plansza na całą wolną wysokość, panele zwarte na dole; (b) bryły w osobnym oknie „Insert solid…” (bez rysowania bryły narzędziem kształtów).

Dodatkowe prośby (druga runda): 4. nazwa nowej notatki kontynuuje serię w folderze (ćw1, ćw2 → ćw3); 5. porządek w menu ⋯ i szybka zmiana narzędzia bez sięgania do paska (przycisk boczny rysika); 6. haptyka.

Trzecia runda (część 5): menu w trzech stylach do wyboru (classic / panels / ribbon); bez kształtu jednorazowego.

## Krok 0
Pierwsza czynność po zatwierdzeniu: skopiować ten plan do repozytorium jako **`docs/PLAN.md`** i zrobić commit, żeby dało się kontynuować pracę na innym komputerze.

## Kolejność realizacji
0 → 2 (układ obwodów, mały zakres) → 4 (nazwy) → 5b (narzędzia i rysik) → 6 (haptyka) → 5a (menu) → 1 (bryły, największa część). Commit po każdej części.

---

## Część 1: okno „Insert solid…”

### Nowe pliki: `src/solid/`
Ten sam podział co `src/circuit/`: czysta geometria bez DOM (testowalna w Node) i osobny modal.

- **`types.ts`**: `SolidKind`, `SolidParams`, `ProjectionKind`, `HiddenMode = 'hide' | 'dashed' | 'solid'`, `SolidSpec { kind, params, projection, yaw, pitch, hidden, axes, centerLines }`.
- **`shapes.ts`**: każda bryła to lista **płatów parametrycznych** `(u,v) → punkt + normalna` (płaskie ściany i powierzchnie zakrzywione) oraz jawnych **krawędzi ostrych** (krawędzie ścian, okręgi podstaw). Bryły w pierwszej wersji:
  - sześcian, prostopadłościan (a, b, c)
  - walec (r, h), rura czyli walec wydrążony (R, r, h)
  - stożek (r, h), stożek ścięty (R, r, h)
  - kula (r), półkula (r)
  - torus, czyli pierścień (R, r)
  - graniastosłup n-kątny i ostrosłup n-kątny (n = 3…8, a, h)
  - czworościan foremny, klin (a, b, h)
- **`projection.ts`**: jedna macierz 4×4, która zamienia punkt na `(x, y)` ekranu plus głębokość `z`:
  - izometria (35,26°/45°), dimetria (ISO 5456-3, 7°/42°), rzut swobodny = trymetria z obrotem `yaw/pitch` zmienianym przeciągnięciem po podglądzie
  - rzut ukośny kawaleryjski (45°, k = 1) i gabinetowy (45°, k = 0,5), czyli macierz ścinania
  - perspektywa (jeden parametr: „siła” perspektywy, czyli odległość oka)
  - **3 rzuty prostokątne** (przód / góra / bok, układ europejski E lub amerykański A): trzy wywołania tego samego potoku dla trzech widoków, ułożone obok siebie z odstępem
  - kierunek patrzenia na potrzeby konturów: `d` dla rzutów równoległych, `p − oko` dla perspektywy
- **`hiddenLines.ts`**: rdzeń algorytmu.
  1. **Kontury** powierzchni zakrzywionych: marching squares na siatce (u,v) dla funkcji `f = n·d`. Daje gładkie linie konturu walca, stożka, kuli i torusa bez „schodków”, które powstają przy liczeniu konturu z siatki trójkątów.
  2. **Krawędzie ostre** z `shapes.ts`.
  3. **Widoczność**: programowy bufor głębokości (`Float32Array`, ok. 1024² w przestrzeni rzutu) z siatki trójkątów płatów. Każdą krawędź tniemy na krótkie odcinki, sprawdzamy głębokość punktu (przesuniętego lekko wzdłuż normalnej, żeby kontur nie zasłaniał sam siebie) z tolerancją i sklejamy sąsiednie odcinki w polilinie `visible[]` / `hidden[]`.
  4. Opcjonalnie **osie symetrii** (walec, stożek, kula, torus) jako linie punkt-kreska.
  - Wynik: `{ visible: Polyline[], hidden: Polyline[], axes: Polyline[] }`, gdzie `Polyline` jest typem z [src/circuit/font.ts](src/circuit/font.ts).
- **`solidModal.ts`**: modal na wzór `CircuitModal`, z tymi samymi klasami `hw-plot-*` / `mod-plot`, żeby wyglądał spójnie:
  - podgląd SVG (biała karta, przeciąganie obraca bryłę i przełącza rzut na „swobodny”)
  - siatka przycisków brył z małymi ikonami SVG (każda ikona rysowana tym samym potokiem, izometria)
  - pola wymiarów zależne od bryły (suwak + pole liczbowe; zmienia się proporcja, rozmiar w notatce ustala osobna opcja)
  - wybór rzutu (segmenty): Iso · Dimetric · Cavalier · Cabinet · Perspective · 3 views · Free
  - krawędzie niewidoczne: Hidden · Dashed · Solid (domyślnie Dashed); przełączniki „Axes / centre lines”
  - dolny pasek jak w obwodach: reset widoku, ⚙ (Small / Standard / Large in the note), Cancel, **Insert solid**
  - stan sesji w `plugin.solidSession` (jak `circuitSession`), żeby ustawienia przetrwały zamknięcie okna

### Wstawianie do notatki
- **`src/view/solidInsert.ts`**: mixin na wzór [circuitInsert.ts](src/view/circuitInsert.ts) (`placeCircuit`). Używa ponownie `resample` / `dropDegenerate` z [src/circuit/resample.ts](src/circuit/resample.ts), dopasowuje rozmiar i środek strony tak samo jak obwód. Kreski `{ poly: true, dash: 'dashed' }` dla krawędzi niewidocznych i `dash: 'dashdot'` dla osi (typ `Stroke` w [src/types.ts:15](src/types.ts#L15) już to obsługuje; `splitSelection` tworzy takie kreski, więc renderer je rysuje). Wszystkie kreski dostają wspólne `g: newId()`, więc jedno dotknięcie zaznacza całą bryłę. Potem jedno `pushHistoryAction({type:'paste'})` i zaznaczenie wyniku, tak jak przy obwodzie.
- Rejestracja mixinu w tym samym miejscu co `circuitInsertMixin` (widok w `src/view/`).
- Punkty wejścia, tak jak `circuit`:
  - [src/view/menus.ts:54](src/view/menus.ts#L54) i `runQuickAction` (`case 'solid'`)
  - [src/quickActions.ts](src/quickActions.ts): `{ id: 'solid', label: '3D solid', icon: … }` (nowa ikona w [src/icons.ts](src/icons.ts))
  - [src/main.ts](src/main.ts): komenda `insert-solid` i pole `solidSession`
- Style: nowa sekcja `/* Insert solid */` w [src/styles.css](src/styles.css), korzystająca z istniejących klas obwodów (`hw-circuit-pal`, `hw-circuit-bar`, `hw-circuit-icon`), żeby nie powielać CSS.
- README (tabela Features + sekcja w „Images, PDFs and maths”), [site/content.mjs](site/content.mjs) (karta funkcji), demo `quickActions` w [site/demo/main.ts](site/demo/main.ts).

---

## Część 2: okno obwodów w pionie (plansza na całą wysokość)

Problem: [styles.css:1258](src/styles.css#L1258) ustawia `.hw-circuit-sheet { width: min(100%, 46vh*4/3) }`, `.hw-circuit-board` ma `aspect-ratio: 4/3`, a `viewBox` jest na stałe `0 0 900 675` ([circuitModal.ts:120](src/circuit/circuitModal.ts#L120)).

Zmiany:
1. **CSS (media portrait / narrow)**: `.hw-circuit-right` i `.hw-circuit-sheet` dostają `flex: 1 1 0; min-height: 0`, a `.hw-circuit-board` ma `height: 100%` i nie ma `aspect-ratio`. Panel boczny (`.hw-circuit-side`) dostaje `flex: 0 0 auto` z `max-height: ~38vh` i przewijaniem w środku. Plansza zabiera całą resztę miejsca. Landscape bez zmian.
2. **Dynamiczny viewBox** w `CircuitModal`: pola `vb = {x, y, w, h}`. `w` zostaje 900 (grubości i tolerancje zachowują się jak dziś), `h = 900 · wysokość/szerokość planszy`. Przeliczane w istniejącym `ResizeObserver`.
   - `pos()` ([:517](src/circuit/circuitModal.ts#L517)) uwzględnia `vb.x / vb.y / vb.w / vb.h`
   - prostokąt z kropkami siatki w `render()` ([:309](src/circuit/circuitModal.ts#L309)) pokrywa cały `vb`
   - `viewK()` / `setPointer()` liczą skalę z `vb.w`
   - `openPicker()` przelicza pozycję z uwzględnieniem przesunięcia `vb`
3. **Wyśrodkowanie przy otwarciu**: `vb` jest centrowany na ramce schematu (bbox węzłów). Nowy przycisk „Fit” w dolnym pasku (ikona `scan`) robi to samo na żądanie.
4. **Pinch-zoom i przesuwanie dwoma palcami** na planszy: zmiana `vb` (skala w granicach 0,5–3×). Jeden palec lub pióro działa jak dziś. Dwa aktywne wskaźniki dotyku anulują `down` / `drag` i włączają gest.
5. **Granice arkusza** w [ops.ts:270](src/circuit/ops.ts#L270) (`parallel`): zamiast stałych `SHEET_W/H` przekazujemy aktualne granice `vb` jako parametr (z domyślną wartością dla testów).
6. **Zwarty panel na dole** (portrait): paleta w jednym rzędzie (`grid-auto-flow: column`, przewijana poziomo, gdy się nie mieści), karta zaznaczenia bez stałego `min-height` (już jest `0`), tytuły sekcji zmniejszone. Kolejność: plansza, paleta, zaznaczenie, pasek.

---

## Część 4: nazwa nowej notatki kontynuuje serię w folderze

Dziś [main.ts:473 `buildNoteName`](src/main.ts#L473) zawsze składa nazwę z ustawień (folder + data), a `createHandwritingNote` ([:484](src/main.ts#L484)) przy kolizji dopisuje ` 001`.

- Nowe ustawienie `continueSeries: boolean` (domyślnie **włączone**; nazwa w UI: *Continue numbered names in the folder*) w [settings.ts](src/settings.ts) plus migracja w `main.ts` obok `nameMode` (ok. [:311](src/main.ts#L311)) i przełącznik w [settingTab.ts](src/settingTab.ts) w sekcji nazw.
- Nowa czysta funkcja `src/noteNaming.ts → detectSeries(names: string[], isSchemeName: (n) => boolean): { prefix, suffix, next, width } | null`, testowalna w Node:
  - bierze nazwy plików `.hnote` z folderu (bez rozszerzenia, tylko bezpośrednie dzieci)
  - **pomija nazwy zgodne ze schematem z ustawień**, czyli regex budowany z tych samych części co `buildNoteName`: część folderowa, data `\d{2}<sep>\d{2}(<sep>\d{4})?`, opcjonalny ` \d{3}`. Bez tego nazwy z datą (kończące się rokiem) wyglądałyby jak seria „…2026”.
  - pozostałe nazwy dopasowuje do `^(.*?)(\d+)(\D*)$` i grupuje po `(prefix, suffix)` bez rozróżniania wielkości liter; wybiera najliczniejszą grupę (remis: ta z najnowszym plikiem)
  - zwraca `next = max + 1`, z dopełnieniem zerami do szerokości, gdy seria jej używa (`ćw01` → `ćw02`)
  - seria liczy się już od **1 pliku** (`zbiór1` → `zbiór2`), bo nazwy ze schematu są wykluczone wcześniej
- `createHandwritingNote`: jeśli `continueSeries` jest włączone i `detectSeries` coś zwróci, nazwa to `prefix + numer + suffix`. W przeciwnym razie (folder pusty albo tylko notatki ze schematu) nazwa powstaje jak dziś. Kolizja jest nadal obsługiwana pętlą `while` (podbija numer serii zamiast dopisywać ` 001`).
- Testy: `tests/noteNaming.test.ts`:
  - `[zbiór1, zbiór2]` → `zbiór3`
  - `[ćw1, ćw2, ćw10]` → `ćw11`
  - `[Lab 01, Lab 02]` → `Lab 03`
  - `[MAT-27-11-2026]` → `null`
  - folder mieszany: seria wygrywa
  - pusty folder → `null`

---

## Część 5: porządek w menu ⋯ i szybka zmiana narzędzia piórem

### 5a. Menu ⋯ jest przeładowane: trzy style do wyboru
Dziś [menus.ts `showMoreMenu`](src/view/menus.ts#L19) to płaska lista: ukryte narzędzia, 3 grupy akcji (wstawianie, widok, plik) i 3 przełączniki. Po dodaniu brył będzie jeszcze dłuższa. Decyzja (runda 3): zamiast jednego nowego układu użytkownik wybiera w ustawieniach jeden z trzech stylów, `menuStyle: 'classic' | 'panels' | 'ribbon'` (Settings → Toolbar → *Menu style*, domyślnie `classic`).

**Wspólna podstawa.** Definicje `groups` z `showMoreMenu` przechodzą do rejestru w [quickActions.ts](src/quickActions.ts) (pola `group: 'insert' | 'view' | 'file'`, `title`, `show?`), plus lista przełączników pióra (pressure, palm rejection, haptics). `runQuickAction` zostaje jedynym dyspozytorem. Wszystkie trzy style czytają ten sam rejestr.

1. **`classic`**: obecne płaskie menu ⋯, bez zmian w działaniu (czyta rejestr, dochodzi przełącznik haptyki).
2. **`panels`**:
   - przycisk **„+ Insert”** na pasku: popover w formie siatki dużych kafelków z ikonami (Image, Screenshot, Function plot, Circuit, 3D solid, Import PDF, Calculator). Przypięte skróty (`quickActions`) dalej działają;
   - **⋯ jako panel z sekcjami** (View, File, Pen) i stopką *Settings*. Akcje jako kafelki z podpisem, przełączniki jako wiersze z checkboxem, ukryte narzędzia (np. Hand) rzędem ikon na górze;
   - kod: `buildActionGrid(host, items)` w `src/view/actionPanels.ts`;
   - w wąskim oknie oba popovery otwierają się jako dolny arkusz na pełną szerokość, kafelki min. 56 px.
3. **`ribbon`**: wstążka z kartami w stylu OneNote, **bez ⋯**. Nad paskiem cienki rząd kart **Draw · Insert · View · File · Pen**:
   - Draw: obecny pasek bez zmian (narzędzia, historia, kolory, przypięte skróty);
   - pozostałe karty pokazują w tym samym rzędzie przyciski z podpisem z rejestru (w wąskim oknie przewijane poziomo). Insert: wstawianie i kalkulator. View: ukryte narzędzia, zoom, contents, pages, page style. File: PDF, druk, historia, Settings. Pen: przełączniki;
   - po wykonaniu akcji (nie przełącznika) wstążka wraca na kartę Draw;
   - kod: `src/view/ribbon.ts`.

### 5b. Rysuję kształt i chcę od razu pisać
Ręka musi iść do paska na drugim końcu ekranu. Rozwiązania, od najprostszego:

(Kształt jednorazowy, czyli automatyczny powrót do poprzedniego narzędzia po narysowaniu kształtu, został odrzucony w rundzie 3.)

1. **Przycisk boczny rysika, nowe akcje** w `penButtonAction` ([settings.ts:82](src/settings.ts#L82), [contextMenu.ts `runPenButton`](src/view/contextMenu.ts#L28), walidacja w [main.ts:305](src/main.ts#L305)):
   - `'swap'`: **kliknięcie przełącza** między bieżącym a poprzednim narzędziem (Shapes ↔ Pen), jak „podwójne stuknięcie” w Apple Pencil. Wymaga pamiętania `prevTool` w `setTool`
   - `'hold'`: **trzymanie przycisku = narzędzie tymczasowe**. Kreska narysowana z wciśniętym przyciskiem idzie wybranym narzędziem (ustawienie *Hold tool*: Pen / Lasso / Eraser / Highlighter), a po puszczeniu wraca poprzednie. Dziś [main.ts:1175](src/main.ts#L1175) przechwytuje `pointerdown` z `buttons & 2` i nie rysuje; dla `'hold'` zamiast tego ustawiamy `this.tempTool` i przepuszczamy zdarzenie. `getEffectiveTool` w [input.ts:154](src/view/input.ts#L154) zwraca `tempTool`, tak jak dziś zwraca `'eraser'` dla końcówki gumki.
   - `'radial'`: **menu kołowe przy rysiku**: kliknięcie przyciskiem w powietrzu albo na stronie otwiera wokół końcówki pierścień z 6–8 polami (narzędzia, 3 ostatnie kolory, cofnij). Wybór kolejnym stuknięciem albo przeciągnięciem w kierunku pola. Nowy `src/view/radialMenu.ts`. Daje dostęp do wszystkiego bez sięgania do paska.
   - Uwaga, Windows: przycisk boczny z dociśniętą końcówką system raportuje jako prawy klik lub „press-and-hold”. Kod już to rozróżnia (`lastPenBarrelAt`), więc `'hold'` musi korzystać z tego samego mechanizmu. Do sprawdzenia na prawdziwym sprzęcie (Surface, Wacom, Android z S Pen).
2. **Gest stuknięcia palcem**: stuknięcie dwoma palcami = cofnij, trzema = ponów (jak w GoodNotes); opcjonalnie, w ustawieniach *Pen and touch*. Tylko gdy odrzucanie dłoni pozwala na dotyk.

Domyślne ustawienia: na Windows zostaje `snip` (nie zmieniamy przyzwyczajeń), na pozostałych platformach domyślnie `swap` zamiast `menu`.

---

## Część 6: haptyka

Stan faktyczny (sprawdzone w kodzie: brak `vibrate` i `haptic`):
- **Wibracja samego rysika** (Surface Slim Pen 2, Apple Pencil Pro) **nie jest dostępna** z wtyczki Obsidian. Wymaga natywnych API (WinRT `PenDevice` / `SimpleHapticsController`, UIKit `UICanvasFeedbackGenerator`), do których renderer Electron ani WebView na iPadzie nie mają dostępu. Nie da się tego zrobić rzetelnie, więc tego nie obiecujemy.
- Dostępna jest **wibracja urządzenia** przez `navigator.vibrate` (Android: telefony i tablety, w tym Samsung z S Pen). Na iPadzie i w desktopowym Electronie ta funkcja nie istnieje albo nic nie robi.

Plan:
- Ustawienie `haptics: 'off' | 'light' | 'strong'` (domyślnie `off`), widoczne tylko gdy `typeof navigator.vibrate === 'function'` (opis w UI: *Vibrates the device, not the pen; Android only*). Przełącznik również w sekcji **Pen** nowego panelu ⋯.
- `src/haptics.ts`: `buzz(kind: 'tick' | 'snap' | 'confirm')`, czyli 8 / 15 / 25 ms (×2 dla `strong`), z ograniczeniem do 1 wibracji na 60 ms.
- Momenty: przyciąganie do kąta (Shift lub prosta), zaznaczenie lasso, zmiana narzędzia przyciskiem bocznym (`swap` / `hold`), wybór w menu kołowym, zatrzaśnięcie przewodu w edytorze obwodów (`b.snap` w [circuitModal.ts:354](src/circuit/circuitModal.ts#L354)).

---

## Weryfikacja
- `npm test` ([scripts/test.mjs](scripts/test.mjs)): nowy `tests/solid.test.ts`:
  - sześcian w izometrii: 9 krawędzi widocznych i 3 niewidoczne
  - kula w rzucie prostokątnym: kontur to okrąg o promieniu r (±1%), brak linii niewidocznych przy `hide`
  - walec od boku: 2 tworzące widoczne, tylna połowa dolnej podstawy niewidoczna
  - torus od góry: dwa okręgi R±r
  - 3 rzuty: trzy rozłączne bboxy
- `tests/noteNaming.test.ts` (część 4).
- Ręcznie: trzy style menu (`classic`, `panels`, `ribbon`) w szerokim i wąskim oknie; przycisk boczny w trybach `swap` / `hold` / `radial` na prawdziwym rysiku; `haptics` na Androidzie wibruje, a na desktopie opcja jest ukryta.
- Istniejący `tests/circuit.test.ts` musi przejść po zmianie sygnatury `parallel`.
- `npm run build` i lint (`eslint.config.mjs`).
- Ręcznie w demo (`scripts/build-site.mjs`) oraz w Obsidianie:
  - DevTools z emulacją pionowego tabletu (ok. 900×1400): plansza wypełnia wysokość, schemat wyśrodkowany, pinch działa, paleta i pasek na dole
  - landscape wygląda bez zmian
  - wstawienie bryły: przerywane krawędzie niewidoczne, tap zaznacza całą bryłę, gumka tnie kreski, cofanie usuwa całość jednym krokiem

---

## Część 3: pomysły (bez implementacji, do decyzji)

**Najbliżej tego, co już jest (inżynier, notatki z wykładu)**
1. **Edycja po wstawieniu**: obwód lub bryła zapisuje swoją specyfikację przy grupie kresek (jak `ImageItem.plot` dla wykresów). „Edit circuit…” w menu zaznaczenia otwiera edytor ponownie. Dziś po wstawieniu nie da się już poprawić schematu.
2. **Wymiarowanie (cotation)**: narzędzie „wymiar” z liniami pomocniczymi, strzałkami i liczbą, do tego wymiar kąta i promienia (R, ⌀). Naturalnie łączy się z bryłami i rzutami.
3. **Wykresy wskazowe (fazory) i trójkąty mocy**: edytor jak w obwodach. Liczby zespolone z kalkulatora rysowane jako wektory (moduł∠kąt), wynik jako kreski.
4. **Rozwiązywanie obwodu**: skoro jest model `Circuit` (węzły, gałęzie, elementy z wartościami w etykietach), metoda węzłowa w DC/AC daje prądy i napięcia na schemacie albo w kalkulatorze. Mocny wyróżnik.
5. **Więcej bibliotek symboli w tym samym edytorze**: dioda, tranzystor, wzmacniacz operacyjny, uziemienie, przełącznik, transformator; potem bramki logiczne, schematy blokowe automatyki (bloki G(s), sumatory, sprzężenie zwrotne), pneumatyka i hydraulika.
6. **Diagramy mechaniki**: belka z podporami, siłami, momentami i obciążeniem ciągłym, z automatycznym wykresem T/M. Dla studentów mechaniki to odpowiednik schematów obwodów.

**Matematyka i dane**
7. **Wykresy rozszerzone**: parametryczne, biegunowe, Bode (moduł i faza z transmitancji), punkty z tabeli lub CSV, wykres 3D powierzchni (z potokiem rzutów z brył).
8. **Rozpoznawanie pisma → LaTeX lub kalkulator**: zaznacz wzór napisany ręcznie i dostań wynik albo blok `$$…$$` w notatce markdown. (Wymaga modelu, więc najpierw decyzja: lokalnie czy przez API.)
9. **Tabele**: wstawiana siatka z komórkami, w które się pisze, przydatna do pomiarów z laboratorium.
10. **Linijka, kątomierz i cyrkiel** jako nakładki, po których rysuje się piórem (jak w OneNote).

**Obsidian i workflow**
11. **Linki z odręcznej notatki**: zaznaczenie → „Link to note” albo osadzanie fragmentu strony w zwykłej notatce `![[note.hnote#page=3]]` jako obraz.
12. **Szablony stron inżynierskich**: tabelka rysunkowa (blok tytułowy), siatka izometryczna, papier milimetrowy, papier logarytmiczny do wykresów Bode.
13. **Eksport zaznaczenia do SVG lub PNG**, żeby wkleić schemat do sprawozdania.

**Moja ocena obecnego stanu**: rdzeń (atrament, strony, lasso, PDF, historia) jest dojrzały. Wyróżnikiem są narzędzia „generuj i wstaw jako kreski”: wynik wygląda jak pisany ręcznie i da się go dalej edytować gumką. Warto trzymać się tej zasady dla każdego nowego generatora. Największa luka to brak powrotu do edycji po wstawieniu (pkt 1), więc proponuję zrobić go zaraz po bryłach.
