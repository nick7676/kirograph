# Piano: integrazione turboquant-js in KiroGraph

**Stato:** bozza da discutere — nessun codice scritto

---

## Crediti e riferimenti

**Ricerca originale — Google Research:**  
*"TurboQuant: Redefining AI Efficiency with Extreme Compression"*  
https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/  
Descrizione: TurboQuant applica una rotazione casuale Walsh-Hadamard ai vettori
prima della quantizzazione scalare Lloyd-Max, distribuendo gli outlier in modo
uniforme su tutte le dimensioni e aumentando drammaticamente l'efficacia della
compressione (fattore 20-30×) rispetto alla quantizzazione diretta.

**Implementazione TypeScript:**  
`turboquant-js` — https://github.com/danilodevhub/turboquant-js  
Autore: **Danilo Dev** ([@danilodevhub](https://github.com/danilodevhub))  
Porta fedele dell'algoritmo TurboQuant in TypeScript puro, zero dipendenze native,
compatibile con browser e Node.js. Espone `VectorIndex`, `TurboQuantMSE`,
`TurboQuantProd`, e `KVCacheCompressor`.

---

## Diagnosi: dov'è il vero problema

`VectorManager` (`src/vectors/index.ts`) ha già 7 engine ANN configurabili via
`config.semanticEngine`. Il problema è altrove:

| Modulo | File | Situazione attuale |
|--------|------|--------------------|
| Codice (code nodes) | `src/vectors/index.ts` | ✅ 7 engine: cosine, sqlite-vec, orama, pglite, lancedb, qdrant, typesense |
| Memory (osservazioni) | `src/memory/vectors.ts` | ⚠️ solo linear cosine scan O(n) — nessun engine configurabile |
| Docs (sezioni doc) | `src/docs/vectors.ts` | ⚠️ solo linear cosine scan O(n) — nessun engine configurabile |

Entrambi `MemoryVectorManager` e `DocsVectorManager` scorrono tutti gli embedding
raw in memoria ad ogni query. Con centinaia di sessioni o migliaia di sezioni doc
questo scala male. I vettori sono Float32 compressi come BLOB in SQLite:
768 float × 4 byte = 3.072 byte/vettore. 10.000 osservazioni = ~30 MB solo in RAM.

---

## Cosa porta turboquant-js

**`VectorIndex`** — indice ANN in-memory, zero dipendenze, puro TypeScript:
- Compressione 20-30x (Walsh-Hadamard rotation + Lloyd-Max scalar quantization)
- 768 float (3.072 byte) → ~100-150 byte compressi per vettore
- Ricerca sub-lineare invece di O(n) cosine scan
- `toBuffer()` / `fromBuffer()` → serializzabile su disco, ricaricabile in ms
- Nessuna dipendenza nativa (a differenza di sqlite-vec, lancedb, qdrant)
- Funziona nel browser (rilevante per il dashboard interattivo)

**`KVCacheCompressor`** — non applicabile qui, è per KV-cache LLM.

---

## Scope dell'intervento

### NON toccare
- Il cosine fallback — rimane per retrocompatibilità su tutti e tre i moduli

### Toccare
1. Nuovo file `src/vectors/turboquant-index.ts` — wrapper riusabile
2. `src/vectors/index.ts` — `VectorManager` usa il nuovo index come 8° engine
3. `src/memory/vectors.ts` — `MemoryVectorManager` usa il nuovo index
4. `src/docs/vectors.ts` — `DocsVectorManager` usa il nuovo index
5. `src/config.ts` — aggiungere `'turboquant'` al tipo `semanticEngine`
6. `package.json` — aggiungere `turboquant-js` come dipendenza opzionale

---

## Dettaglio implementativo

### Step 1 — `src/vectors/turboquant-index.ts`

Speculare a `src/vectors/vec-index.ts`. Interfaccia pubblica:

```typescript
export class TurboQuantIndex {
  constructor(
    private readonly binPath: string,
    private readonly dim: number,    // embeddingDim dal config
    private readonly bits: number,   // turboquantBits dal config (default: 3)
  ) {}

  isAvailable(): boolean       // true se turboquant-js è installato
  async initialize(): void     // fromBuffer() se il .bin esiste, altrimenti new VectorIndex()
  upsert(id: string, vec: Float32Array): void  // add() comprime internamente
  delete(id: string): void
  search(query: Float32Array, topN: number): string[]
  getEmbeddedIds(): string[]
  count(): number
  memoryStats(): { totalBits: number; bitsPerVector: number; compressionRatio: number; actualBytes: number }
  async save(): void           // toBuffer() → write atomico su .bin
  close(): void
}
```

**Come funziona la compressione nel codice:**

`VectorIndex.add(id, Float32Array)` comprime il vettore internamente:
1. Walsh-Hadamard transform + random sign flips → distribuzione uniforme
2. Lloyd-Max scalar quantization → ogni coordinata in `bits` bit

Il `Float32Array` raw (3.072 byte per 768 dim) entra, l'indice lo archivia
compresso (~120 byte a 3 bit). Non vengono mai scritti Float32 raw su disco
quando l'engine è `turboquant`.

Dettagli implementativi:
- `VectorIndex` richiede `dimension` e `bits` all'init. `bits` default: **3**
  (20-30× compressione). Configurabile via `turboquantBits` nel config.
- Import dinamico con try/catch — se `turboquant-js` manca, `isAvailable()` → false
  e tutti i manager fanno fallback al cosine senza rompere niente.
- `save()` usa write atomico (tmp → rename) come `_writeAtomic` in `config.ts`.
- `save()` chiamato solo a fine indicizzazione (`embedAll()` / `embedBatch()`),
  non ad ogni `upsert()`.
- `memoryStats()` espone `VectorIndex.memoryUsage` per `kirograph status`.

**Stima RAM con 768 dim, 3 bit:**
- 1 vettore raw: 768 × 4 = 3.072 byte → compresso: ~120 byte (≈25× meno)
- 10.000 nodi raw in RAM: ~30 MB → compressi: ~1,2 MB
- 100.000 nodi raw in RAM: ~300 MB → compressi: ~12 MB

### Step 2 — `src/vectors/index.ts` (VectorManager — 8° engine)

Aggiungere `turboquantIndex` seguendo il pattern meccanico già replicato 6 volte.

**Comportamento critico — nessun Float32 raw in SQLite:**
Quando l'engine è `turboquant`, si salta la riga:
```typescript
this.db.storeEmbedding(node.id, embedding, modelId);
```
esattamente come già fa `sqlite-vec` (condizione a riga 291 e 438 di
`src/vectors/index.ts`). Il Float32Array raw viene passato a
`turboquantIndex.upsert()` che lo comprime internamente — niente finisce
nella tabella `vectors` di SQLite.

Cambiamenti meccanici:
- `private turboquantIndex: TurboQuantIndex | null = null`
- `initialize()`: branch `engine === 'turboquant'` → `new TurboQuantIndex(kirographDir, embeddingDim, config.turboquantBits ?? 3)`
- `embedNode()`: `turboquantIndex?.upsert(node.id, embedding)` nel dispatch esistente
- `embedAll()`: stessa logica nel loop batch; chiamare `turboquantIndex.save()` a fine
- `search()`: branch `turboquantIndex?.isAvailable()` → `turboquantIndex.search(queryVec, topN)`
- `deleteEmbeddings()`: `turboquantIndex?.delete(id)`
- `vecIndexCount()`: `turboquantIndex?.count()`

### Step 3 — `src/memory/vectors.ts`

Pilota `config.turboquantMemDocs`. Differenza chiave rispetto ai code nodes:
i raw Float32 rimangono in `mem_vectors` SQLite (servono per `reembed()`),
ma il TurboQuantIndex sostituisce il linear cosine scan nelle query.

```
se turboquantMemDocs === true e TurboQuantIndex.isAvailable()
  → upsert() su TurboQuantIndex (comprime) in aggiunta al BLOB SQLite
  → search() usa TurboQuantIndex invece del linear scan
altrimenti
  → comportamento attuale (cosine scan su getAllVectors())
```

Il linear scan carica **tutti** i Float32 da SQLite ad ogni query:
`this.memDb.getAllVectors(this.modelName)` → `for (const { embedding } of allVectors)`
Con TurboQuantIndex questo non accade: l'indice compresso è già in memoria.

Cambiamenti:
- `constructor`: `if (config.turboquantMemDocs) this.tqIndex = new TurboQuantIndex(...'turboquant-mem.bin'...)`
- `embedObservation()`: dopo il BLOB SQLite → `this.tqIndex?.upsert(obs.id, embedding)`
- `search()`: se `this.tqIndex?.isAvailable()` → usa TurboQuantIndex, skip linear scan
- `reembed()`: chiama `this.tqIndex?.save()` alla fine

### Step 4 — `src/docs/vectors.ts`

Identico a Step 3 ma per `DocsVectorManager` con `turboquant-doc.bin`.
La sezione da rimpiazzare è il loop `for (const { section_id, embedding } of allVectors)`
in `search()` — stesso linear scan O(n) sullo stesso pattern.

### Step 5 — `src/config.ts`

Tre modifiche:

```typescript
// 1. Tipo semanticEngine — aggiungere 'turboquant'
semanticEngine: 'cosine' | 'turboquant' | 'sqlite-vec' | 'orama' | 'pglite' | 'lancedb' | 'qdrant' | 'typesense';

// 2. Nuovi campi
turboquantMemDocs: boolean;   // default: false
turboquantBits: number;       // default: 3 (1–8, tradeoff qualità/compressione)
```

Aggiornare `KNOWN_FIELDS`, `SEMANTIC_ENGINES`, `validateConfig()`, e
`createDefaultConfig()`. Il `turboquantBits` va clampato a [1, 8].

### Step 6 — `package.json`

```json
"optionalDependencies": {
  "turboquant-js": "^1.0.0"
}
```

Opzionale come `better-sqlite3` e `sqlite-vec` — chi non lo installa continua
a usare cosine senza avvisi bloccanti.

---

## Flusso dati completo dopo l'integrazione

```
Memory obs / Doc section
        │
        ▼
  @huggingface/transformers
  (pipeline esistente, invariata)
        │
        ▼ Float32Array (768 dim)
        │
  ┌─────┴─────────────────────────────────┐
  │  se semanticEngine === 'turboquant'   │
  │                                       │
  │  TurboQuantIndex.upsert()             │
  │  (comprime + aggiunge all'indice)     │
  │                                       │
  │  → .kirograph/turboquant-{mem,doc}.bin│
  │    (serializzato su save())           │
  └─────┬─────────────────────────────────┘
        │
        ▼ altrimenti (invariato)
  Float32 BLOB in SQLite
  cosine scan lineare ad ogni query
```

---

## Stima dimensioni

| Scenario | Prima (raw Float32) | Dopo (TurboQuant 4-bit) |
|----------|---------------------|-------------------------|
| 1.000 osservazioni | ~3 MB RAM | ~150 KB |
| 5.000 osservazioni | ~15 MB RAM | ~750 KB |
| 10.000 sezioni doc | ~30 MB RAM | ~1.5 MB |

I dati raw rimangono comunque in SQLite (compatibilità). L'indice TurboQuant è
solo il layer di ricerca, non sostituisce lo storage primario.

---

## Rischi e domande aperte

1. **Recall quality**: turboquant-js riporta Recall@10 al 36-50% su dataset piccoli
   (500 vettori). Su dataset più grandi la qualità migliora. Per uso reale con
   migliaia di osservazioni è accettabile — ma va deciso: vogliamo comunicarlo
   all'utente? Aggiungere un warning in `kirograph status`?

2. **Dimensione embedding**: `VectorIndex` di turboquant-js richiede dimensione
   fissa all'init. Se l'utente cambia modello (e quindi `embeddingDim`), il file
   `.bin` va invalidato e ricostruito — come già accade per le altre engine.
   Aggiungere un header con la dim al `.bin` per la validazione?

3. **Thread safety**: il processo MCP è single-threaded, quindi nessun problema
   di concorrenza sull'indice in-memory. Ma `save()` su disco va fatto in modo
   atomico (write tmp → rename) come già fa `_writeAtomic` in `config.ts`.

4. **Recall@10 al 36-50% su dataset piccoli**: su codebase grandi (10K+ nodi)
   la qualità migliora. Vogliamo mostrare un warning in `kirograph status`
   quando turboquant è attivo su dataset < 500 vettori?

5. **Dashboard browser**: `VectorIndex.fromBuffer()` funziona in browser. Questo
   apre la possibilità di caricare l'indice nel dashboard per ricerca client-side.
   Fuori scope per ora, ma da tenere in mente come benefit futuro.

---

## Installer (`src/bin/installer/config-prompt.ts`)

### Code nodes — engine selection

Turboquant è un engine alternativo a cosine, **non** un add-on da chiedere dopo.
Non ha senso proporlo se l'utente ha già scelto sqlite-vec, lancedb, orama, ecc.
(quelli fanno già ANN). La soluzione è aggiungerlo come **8° opzione** nell'`arrowSelect`
degli engine, subito dopo cosine, con una descrizione che spiega il valore:

```typescript
{ value: 'turboquant', label: 'turboquant', description: 'ANN index, zero native deps. Faster than cosine on large codebases — no need for better-sqlite3 or native bindings. Optional dep: npm install turboquant-js.' },
```

Posizione: seconda voce (dopo cosine, prima di sqlite-vec), così l'upgrade path
è immediato per chi vuole ANN senza complessità.

### Memory e Docs — domanda separata

`MemoryVectorManager` e `DocsVectorManager` usano sempre cosine implicito — non
c'è selezione engine per loro nell'installer oggi. La domanda va aggiunta:
- **dopo** la selezione dell'engine dei code nodes
- **solo se** `enableEmbeddings === true`
- **solo se** l'engine scelto è `cosine` (se è già turboquant/sqlite-vec/etc. per
  i code nodes, l'utente ha già dimostrato di voler un ANN — proporre turboquant
  anche per memory/docs come default silenzioso è ragionevole, oppure chiedere)

Testo del prompt:

```
TurboQuant for memory & docs search (optional):
Speeds up semantic search in memory observations and doc sections — replaces
the default linear cosine scan with a compressed ANN index (no native deps).
Only relevant when you accumulate many observations or large doc sets.
```

Opzioni: `yes / no (default: no)` con `askToggle`.

Se yes → `config.turboquantMemDocs = true` (nuovo campo, default `false`).
Questo campo pilota se `MemoryVectorManager` e `DocsVectorManager` usano
`TurboQuantIndex` invece del cosine scan.

Nota: se l'engine scelto per i code nodes è già `turboquant`, la stessa libreria
è già installata e la domanda può essere saltata o pre-selezionata su yes.

---

## Docs — `docs/guide/configuration.md`

### Config Fields table

Nella sezione **Semantic Search** aggiungere/sostituire due righe:

```
| `semanticEngine` | string | `cosine` | Engine: `cosine`, `turboquant`, `sqlite-vec`, `orama`, `pglite`, `lancedb`, `qdrant`, `typesense` |
| `turboquantMemDocs` | boolean | `false` | Use TurboQuant ANN index for memory and doc section search (requires `turboquant-js`) |
```

### Sezione "Semantic Engines"

Aggiungere blocco **`turboquant`** subito dopo `cosine`, prima di `sqlite-vec`.

### Engine Comparison table

```
| `turboquant` | ANN, sub-linear | `turboquant-js` | no (pure JS) | ANN without native deps, CI/ARM, large codebases |
```

### Storage Architecture table

```
| `turboquant` | `kirograph.db` (SQLite) | `.kirograph/turboquant.bin` (+ `turboquant-mem.bin`, `turboquant-doc.bin` if `turboquantMemDocs: true`) |
```

### Nuova sezione dedicata

Aggiungere `## TurboQuant` dopo `## Semantic Search`, prima di `## Architecture Analysis`.
Stile pari alla sezione Architecture Analysis: sottosezioni, tabelle, blocchi codice.

```markdown
## TurboQuant

TurboQuant is an optional upgrade that **compresses your vector embeddings at storage
time** and replaces the default linear scan with an approximate nearest-neighbour (ANN)
index — with **zero native dependencies**.

Built on [turboquant-js](https://github.com/danilodevhub/turboquant-js), a TypeScript
implementation of Google's TurboQuant algorithm. Embeddings are compressed using a
two-stage pipeline the moment they are generated — no separate compression step:

1. **Random rotation** via Walsh-Hadamard transform with random sign flips in O(d log d).
   Distributes energy uniformly across all coordinates before quantization.
2. **Lloyd-Max scalar quantization** per rotated coordinate. Each value is encoded in
   `turboquantBits` bits (default: 3) using optimal codebooks derived from
   Beta/Gaussian approximations.

### What gets compressed

A 768-dim `Float32Array` produced by the embedding model is 3,072 bytes (768 × 4).
TurboQuant stores it as ~120 bytes at 3 bits — roughly **25× smaller**:

| Vectors | Raw Float32 in RAM | TurboQuant (3 bit) | Reduction |
|---------|-------------------|-------------------|-----------|
| 1,000   | ~3 MB             | ~120 KB            | 25×       |
| 10,000  | ~30 MB            | ~1.2 MB            | 25×       |
| 100,000 | ~300 MB           | ~12 MB             | 25×       |

The compressed index is the only thing stored on disk (`.kirograph/turboquant.bin`).
Raw `Float32` values are **never written to disk or loaded into RAM** when TurboQuant
is active as the code-node engine.

For memory observations and doc sections, the raw Float32 stays in SQLite (needed
for re-embedding with a different model), but TurboQuant replaces the bulk RAM load
that happens on every search query.

### When to use TurboQuant

| Situation | Recommendation |
|-----------|---------------|
| Small project, < 5,000 symbols | `cosine` is fine |
| Large project, native modules OK | `sqlite-vec` or `lancedb` |
| Large project, **no native modules** (CI, ARM, restricted env) | **`turboquant`** |
| Memory or docs search getting slow | `turboquantMemDocs: true` |

### Code node search

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "turboquant"
}
```

```bash
npm install turboquant-js
```

Each embedding is compressed immediately on `kirograph index`. The index is
serialized to `.kirograph/turboquant.bin` at the end of indexing and reloaded
in milliseconds on startup. If `turboquant-js` is not installed, falls back
silently to `cosine`.

### Memory and doc section search

`MemoryVectorManager` and `DocsVectorManager` always use an implicit linear cosine
scan regardless of `semanticEngine`. Enable TurboQuant independently for them:

```json
{
  "turboquantMemDocs": true
}
```

This replaces the O(n) bulk RAM load on every query:
- **Memory** (`kirograph_mem_search`, `kirograph_mem_context`) → `.kirograph/turboquant-mem.bin`
- **Docs** (`kirograph_docs_search`) → `.kirograph/turboquant-doc.bin`

Can be combined with any code-node engine:

```json
{
  "enableEmbeddings": true,
  "semanticEngine": "cosine",
  "turboquantMemDocs": true
}
```

### Compression tuning

The `turboquantBits` field (default: `3`, range: `1–8`) controls the
quality/compression tradeoff:

| Bits | Compression | Recall@10 (large datasets) | Best for |
|------|-------------|---------------------------|----------|
| `1`  | ~100×       | low                        | extreme memory constraints |
| `3`  | ~25×        | good (default)             | balanced |
| `4`  | ~20×        | better                     | more recall needed |
| `8`  | ~8×         | high                       | near-exact results |

```json
{ "turboquantBits": 4 }
```

Changing `turboquantBits` invalidates the existing `.bin` files — run
`kirograph index --force` to rebuild.

### Storage

| Context | File | Compressed size (est. 10K vectors, 768 dim, 3 bit) |
|---------|------|----------------------------------------------------|
| Code nodes | `.kirograph/turboquant.bin` | ~1.2 MB |
| Memory | `.kirograph/turboquant-mem.bin` | ~1.2 MB |
| Docs | `.kirograph/turboquant-doc.bin` | ~1.2 MB |

Delete any `.bin` file to force a full rebuild on the next index run.
Raw embeddings in `kirograph.db` (cosine) or the other engine stores are
unaffected — you can switch back by changing `semanticEngine`.

### Recall

TurboQuant is approximate. Recall@10 on datasets of 500 vectors: 36–50% at 3 bits.
On larger datasets (10K+) recall improves significantly. For exact nearest-neighbour
results use `pglite` instead.
```

---

## README.md

### Features table — Semantic Search section

Sostituire le due righe esistenti della sezione Semantic Search con tre:

```markdown
| <h4>Semantic Search</h4> | |
| ⚡ **8 Semantic Engines** | Cosine, TurboQuant, sqlite-vec, Orama, PGlite, LanceDB, Qdrant, Typesense — pick the best fit for your project |
| 🗜️ **TurboQuant Embedding Compression** | Compresses embeddings 20–30× at index time using Google's TurboQuant algorithm (Walsh-Hadamard + Lloyd-Max quantization). A 768-dim Float32 vector (3,072 bytes) becomes ~120 bytes — 300 MB of raw embeddings shrinks to ~12 MB in RAM. ANN search with zero native dependencies, pure TypeScript. Configurable via `turboquantBits`. |
| 🤖 **Custom Embedding Models** | Use any HuggingFace `feature-extraction` model — nomic, Gemma, MiniLM, BGE, or bring your own |
```

La riga TurboQuant ha la stessa lunghezza e densità delle altre feature della
tabella (vedi Watchmen, Security) — non è un punto elenco ma una feature a pieno
titolo con numeri concreti e spiegazione del meccanismo.

---

## CHANGELOG.md

Nuova voce in cima, stesso stile di `[0.20.0]` e `[0.19.1]`:

```markdown
## [0.21.0] - 2026-XX-XX: TurboQuant embedding compression

### Added

- **TurboQuant semantic engine** (`"semanticEngine": "turboquant"`): 8th vector
  search engine powered by [turboquant-js](https://github.com/danilodevhub/turboquant-js)
  (Google's TurboQuant algorithm). Pure TypeScript, zero native dependencies.
  **Compresses embeddings at index time**: each 768-dim `Float32Array` (3,072 bytes)
  is reduced to ~120 bytes via Walsh-Hadamard rotation + Lloyd-Max scalar quantization
  (approx. 25x compression at the default 3 bits). 100K symbols go from ~300 MB to
  ~12 MB in RAM. No raw Float32 values are written to disk or held in RAM — the
  compressed ANN index (`.kirograph/turboquant.bin`) is the only artifact. Loaded from
  binary in milliseconds on startup. Falls back silently to `cosine` if `turboquant-js`
  is not installed. Optional dependency: `npm install turboquant-js`.

- **`turboquantMemDocs` config field** (boolean, default `false`): applies TurboQuant
  compression and ANN indexing to memory observations and doc section search.
  Replaces the O(n) linear cosine scan that loads all raw Float32 vectors from SQLite
  into RAM on every query. Serializes to `.kirograph/turboquant-mem.bin` and
  `.kirograph/turboquant-doc.bin`. Works independently of `semanticEngine`.

- **`turboquantBits` config field** (number, default `3`, range `1-8`): controls
  the compression/quality tradeoff. Lower values compress more, higher values improve
  recall. Changing this field requires `kirograph index --force`.

- **`kirograph status` compression stats**: when TurboQuant is active, shows
  compression ratio, bits per vector, and actual index size in bytes.

- **Installer**: `turboquant` now appears as the 2nd engine choice in `kirograph install`
  (after `cosine`, before `sqlite-vec`), with a clear note on zero native deps and
  compression benefits. When `cosine` or `turboquant` is chosen, a follow-up prompt
  offers TurboQuant for memory and doc search (`turboquantMemDocs`).
```

---

## Compressione: stats e risparmio visibile

### `.kirograph/turboquant-stats.json` (nuovo file)

Scritto da `TurboQuantIndex.save()` a fine ogni `kirograph index`.
Permette a `status` e `gain` di leggere le stats senza caricare l'intero indice.

```json
{
  "count": 10000,
  "dim": 768,
  "bits": 3,
  "compressionRatio": 25.3,
  "actualBytes": 1228800,
  "rawBytes": 30720000,
  "savedBytes": 29491200,
  "memEnabled": true,
  "memCount": 3200,
  "memActualBytes": 393216,
  "memRawBytes": 9830400,
  "docsEnabled": true,
  "docsCount": 1500,
  "docsActualBytes": 184320,
  "docsRawBytes": 4608000,
  "updatedAt": 1749340800
}
```

Formule: `rawBytes = count × dim × 4`, `savedBytes = rawBytes - actualBytes`.
File scritto atomicamente (tmp → rename).

---

### `kirograph status` — sezione TurboQuant

Nella sezione "Semantic Search" esistente, aggiungere per engine `turboquant`:

```
  Engine     turboquant  (3 bits · 25.3× compression)
  Indexed    10,000 / 10,000  (100%)
  Raw size   30.0 MB  →  compressed  1.2 MB  (28.8 MB saved)
```

Se `turboquantMemDocs: true`, aggiungere sotto:

```
  Memory     3,200 observations  →  9.4 MB → 0.4 MB  (9.0 MB saved)
  Docs       1,500 sections      →  4.4 MB → 0.2 MB  (4.2 MB saved)
```

Totale opzionale in fondo alla sezione:

```
  Total RAM  42.1 MB saved (TurboQuant compression)
```

Dati letti da `.kirograph/turboquant-stats.json`. Se il file non esiste
(primo avvio, indice non ancora costruito) mostrare `(not yet indexed)`.

---

### `kirograph gain` — categoria TurboQuant

Aggiungere righe nella sezione "By source" del default summary (visibili
automaticamente quando TurboQuant è attivo, senza flag aggiuntivi):

```
  By source:
    📊 Graph tools:   1,240 calls  ~4.2M tokens saved (vs file reads/grep)
    ⚡ Compression:     890 calls  ~1.8M tokens saved (vs raw output)
    🗜️ TurboQuant:   14,700 embeddings — 42.1 MB saved (25.1× avg compression)
```

Il numero di token non si applica a TurboQuant (è RAM/disk, non token) —
la riga usa MB esplicitamente. Dati letti da `.kirograph/turboquant-stats.json`,
**senza** aprire il VectorIndex. Se il file non esiste la riga non appare.

Modifiche a `GainStats` in `tracker.ts`:

```typescript
turboquant?: {
  totalEmbeddings: number;
  savedBytes: number;
  compressionRatio: number;
};
```

Popolato in `gain.ts` leggendo il JSON file, non dal tracker.

---

## Ordine di lavoro suggerito

- [x] Step 1 — `TurboQuantIndex` wrapper (`src/vectors/turboquant-index.ts`)
- [x] Step 2 — integrazione `VectorManager` come 8° engine (`src/vectors/index.ts`)
- [x] Step 3 — integrazione `MemoryVectorManager` (`src/memory/vectors.ts`)
- [x] Step 4 — integrazione `DocsVectorManager` (`src/docs/vectors.ts`)
- [x] Step 5 — `config.ts` + validazione (`'turboquant'` in `semanticEngine`, `turboquantMemDocs`, `turboquantBits`)
- [x] Step 6 — `config-prompt.ts` — 8° engine nell'arrowSelect + domanda mem/docs
- [x] Step 7 — `package.json` opzionale
- [x] Step 8 — `kirograph status` — stats TurboQuant nella sezione Semantic Search
- [x] Step 9 — `kirograph gain` — riga `🗜️ TurboQuant` nel summary + lettura stats
- [x] Step 10 — `docs/guide/configuration.md` (config table + sezione `## TurboQuant` + comparison/storage tables)
- [x] Step 11 — `README.md` (feature row `🗜️ TurboQuant Embedding Compression` + "8 Semantic Engines")
- [x] Step 12 — `CHANGELOG.md` (nuova voce `[0.21.0]`)

---

## Altri moduli: cosa si avvantaggia e cosa no

### Architecture — nessun beneficio diretto

`arch_packages`, `arch_layers`, `arch_coupling` sono dati puramente relazionali
(pacchetti, layer, Ca/Ce/instability, dipendenze tra pacchetti). Nessun vettore,
nessuna ricerca semantica. TurboQuant non ha niente da comprimere qui.

**Possibilità futura (fuori scope ora):** embedding aggregati per pacchetto —
media degli embedding di tutti i simboli che contiene — per rispondere a
"trova pacchetti semanticamente simili a X". Richiede una pipeline separata
e non è parte di questa integrazione.

### Security — nessun beneficio diretto

`sec_vulnerabilities`, `sec_reachability`, `sec_dependencies`: dati relazionali
puri. Dataset sempre piccolo (poche centinaia di CVE al massimo). Tutto già
interrogato via SQL su CVE ID, CVSS score, ecosystem. Nessun caso d'uso semantico
realistico qui.

### `kirograph_context` — beneficio automatico

`src/context/index.ts` chiama direttamente `VectorManager.search(query, maxNodes)`
per la fase semantica del context building. Se `semanticEngine: 'turboquant'`,
il context building eredita automaticamente ANN compresso senza modifiche.
Nessun codice da toccare — è un beneficio gratuito.

### `KVCacheCompressor` — inapplicabile

turboquant-js espone anche `KVCacheCompressor` per comprimere il KV cache
dei transformer durante l'inferenza. `src/watchmen/synthesize.ts` usa un
modello generativo locale via `@huggingface/transformers` pipeline, ma il
KV cache è gestito internamente da ONNX Runtime e non è accessibile dal
userspace tramite la pipeline API. **Fuori scope, confermato.**

### File read cache — opportunità separata (non TurboQuant)

`src/mcp/cache.ts` accumula il contenuto testuale di tutti i file letti
durante la sessione in un `Map<path, {content, hash}>` senza limite di size.
Su progetti grandi con sessioni lunghe può crescere significativamente.

Questa è testo, non float — TurboQuant non si applica. La soluzione giusta
è zlib/brotli sul content prima di metterlo in cache. **Fuori scope da questo
piano, ma vale la pena aprire un issue separato.**

### Community detection — solo RAM, no vettori

`src/graph/communities.ts` (Leiden algorithm) costruisce una mappa di adiacenza
`Map<string, Map<string, number>>` per l'intero grafo. Su codebase grandi
(10K+ nodi, 100K+ edge) può essere significativa. Nessun vettore — TurboQuant
non si applica. Struttura già compatta (pesi interi). Fuori scope.

### Patterns / ast-grep — complementarità genuina (nuova query type)

Nessun beneficio di compressione (pattern_matches non ha vettori), ma c'è
un'opportunità concreta di combinare i due sistemi.

**ast-grep** trova pattern strutturali esatti: "SQL injection alla riga X".
**TurboQuant** trova codice semanticamente simile a una query in linguaggio naturale.
Sono assi ortogonali — e il bridge esiste già: `pattern_matches.symbol_node_id`
è già una FK verso `nodes.id`.

**Query oggi impossibile, domani possibile:**
> "Trova tutte le SQL injection in codice correlato all'autenticazione"

Implementazione:
1. TurboQuant `search("authentication", topN=50)` → lista di `node_id`
2. `SELECT * FROM pattern_matches WHERE symbol_node_id IN (...)` → solo i match
   nei simboli semanticamente vicini alla query
3. Output: pattern di sicurezza filtrati per rilevanza semantica

Questo richiede **zero codice nuovo nella pipeline TurboQuant** — è solo un
nuovo utilizzo dei risultati di `VectorManager.search()` in un tool MCP.

Possibili punti di integrazione (tutti opzionali, da valutare dopo):

| Tool | Oggi | Con TurboQuant |
|------|------|----------------|
| `kirograph_context` | pattern matches dai file rilevanti (max 5, per file) | pattern matches dai simboli semanticamente vicini alla query |
| `kirograph_pattern_search` (nuovo) | non esiste | query NL → simboli simili → JOIN pattern_matches → security findings rilevanti |
| `kirograph_impact` | pattern matches sul simbolo target | idem (già funziona, nessun cambio) |

La nuova query in `kirograph_context` sarebbe il cambiamento più naturale:
se `enableEmbeddings` e `enablePatterns` sono entrambi true, la sezione
"pattern findings" del context usa i `node_id` restituiti dal vector search
invece di filtrare per file path.

**Questo non è parte del piano attuale** — va discusso separatamente.
È però un argomento per cui attivare sia TurboQuant che ast-grep insieme
ha valore superiore alla somma delle parti.

---

## Nuove implementazioni abilitate da TurboQuant

Queste sono feature nuove che TurboQuant rende fattibili — non modifiche
all'integrazione core già pianificata. Nessuna di queste è nel piano attuale;
vanno discusse separatamente.

---

### A. `kirograph_similar` — nuovo tool MCP

**Nessun tool simile esiste oggi.** `kirograph_search` cerca per nome/FTS,
i tool strutturali cercano per grafo. Non esiste un modo per chiedere
"trova funzioni che fanno cose simili a questa".

```
kirograph_similar({ nodeId: "fn:abc123", topN: 10, kinds: ["function","method"] })
→ [{node, similarity}, ...]
```

Implementazione: esporre `VectorManager.search(nodeText, topN)` come MCP tool
con filtri opzionali per `kinds`, `filePath`, `package`. Cinque righe di codice
una volta che il TurboQuantIndex è attivo.

Caso d'uso principale: trovare **reimplementazioni** della stessa logica in
parti diverse del codebase. Dead code semantico, non solo strutturale.

**Prerequisiti:** `enableEmbeddings: true`. Si registra solo quando embeddings
è abilitato (come già fa `kirograph_live_search` per patterns).

---

### B. Memory near-duplicate detection

Deduplication attuale in `MemoryManager.store()`: solo hash esatto.
"Fixed the auth bug" e "Resolved authentication issue" → due osservazioni distinte.

Hook da aggiungere prima di `memDb.insertObservation()`:

```typescript
if (this.vectorMgr.isEnabled() && config.turboquantMemDocs) {
  const near = await this.vectorMgr.findNearest(newEmbedding, threshold: 0.92);
  if (near) return { id: near.observationId, deduplicated: true };
}
```

Benefici:
- Previene bloat della memoria su sessioni lunghe
- Migliora qualità sintesi Watchmen (meno rumore nei dati)
- Non richiede nuovo campo in config — è automatico quando `turboquantMemDocs: true`

Richiede un nuovo metodo `MemoryVectorManager.findNearest(vec, threshold)`.

---

### C. `kirograph_dead_code` con ranking semantico

Dead code oggi: booleano (zero incoming refs → morto). Non distingue tra
codice veramente isolato e falsi positivi da resolution fallita.

Con TurboQuant: aggiungere campo `semanticIsolationScore` (0.0–1.0) all'output.

```
score = fraction of K nearest semantic neighbors that are also dead or disconnected
```

Simboli con score alto: logica veramente orfana.
Simboli con score basso: probabilmente falsi positivi (il codice è simile a
cose vive — la resolution non ha trovato il link).

Nessuna modifica alla detection logic. Solo un post-processing sui risultati
usando `VectorIndex.search()` per ogni simbolo morto.

---

### D. Semantic drift negli snapshot

`SnapshotManager` (`src/core/snapshot.ts`) salva snapshot strutturali e
calcola diff (nodi aggiunti/rimossi, edge aggiunti/rimossi). Non cattura
cambiamenti semantici: stessa struttura, semantica completamente cambiata.

Con TurboQuant: al salvataggio dello snapshot, calcolare il **centroide**
per file o package (media degli embedding compressi — fattibile senza
decomprimere con `TurboQuantProd.innerProduct`). Al diff:

```
semanticDrift(moduleX) = 1 - cosine(centroid_v1, centroid_v2)
```

Output: nuovo campo `semanticDrift` per ogni package nel `GraphDiff`.
"Il modulo auth ha driftato semanticamente del 34% tra v1 e v2 anche
se non ha perso nodi."

Artefatto: `.kirograph/snapshots/<label>-embeddings.bin` (centroidi compressi).

---

### E. Docstring quality — `kirograph_hotspots --docquality`

Embed `name + signature` separatamente da `docstring` per ogni simbolo.
Bassa cosine similarity tra i due → la docstring probabilmente non descrive
quello che la funzione fa.

Integrabile come nuova categoria in `kirograph_hotspots` (già esistente)
oppure come flag `--docquality`. Output: lista di simboli con
`docCodeAlignment` score basso.

Prerequisito: `enableEmbeddings: true` (gli embedding dei simboli esistono già).
La similarity è calcolabile a posteriori sugli embedding già indicizzati.

---

### F. Affected tests semantici

`kirograph_affected` usa traversal strutturale (chi importa i file cambiati).
Non trova test che coprono funzionalità correlate senza import diretti.

Aggiunta: sezione `"semanticallyRelated"` nell'output di `kirograph_affected`:

```typescript
const semanticCandidates = await vectorMgr.search(changedSymbolDescription, 20);
const testFiles = semanticCandidates
  .filter(n => isTestFile(n.filePath))
  .map(n => n.filePath);
```

Distinta da `"structurallyLinked"` — l'agente può decidere quali controllare.

---

### Priorità suggerita

| Feature | Effort | Valore | Dipende da |
|---------|--------|--------|------------|
| A. `kirograph_similar` | basso | alto | TurboQuantIndex attivo |
| B. Memory deduplication | medio | alto | `turboquantMemDocs` |
| C. Dead code ranking | medio | medio | TurboQuantIndex attivo |
| D. Snapshot semantic drift | alto | medio | TurboQuantIndex + SnapshotManager |
| E. Docstring quality | basso | medio | embedding già indicizzati |
| F. Affected tests semantici | basso | medio | TurboQuantIndex attivo |

---

## Domande per la discussione

1. Il Recall@10 al 36-50% è accettabile per le query di memoria/docs, o preferiamo
   spingere l'utente verso sqlite-vec/lancedb per la qualità?
2. Salvare il `.bin` ad ogni upsert, o solo a fine indexing (`save()` esplicito)?
3. Se l'utente sceglie `turboquant` come engine per i code nodes, la domanda
   per memory/docs viene saltata (già installato) o mostrata comunque?
4. Vogliamo che `kirograph_context` usi il vector search per filtrare i pattern
   matches quando sia embeddings che patterns sono abilitati? (feature separata)
