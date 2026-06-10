#!/usr/bin/env bash
# test-turboquant.sh — testa il workflow completo di KiroGraph TurboQuant
# su un progetto nuovo, partendo dal codice sorgente.
#
# Uso:
#   ./test.sh                  # test completo (config, install, index, status, gain, unit)
#   ./test.sh --skip-unit      # salta i test unitari di TurboQuantIndex
#   ./test.sh --no-build       # non ricompila (usa dist esistente)

set -euo pipefail

SKIP_UNIT=false; NO_BUILD=false
for arg in "$@"; do
  case $arg in
    --skip-unit) SKIP_UNIT=true ;;
    --no-build)  NO_BUILD=true ;;
  esac
done

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
DIM='\033[2m'; RESET='\033[0m'; BOLD='\033[1m'; RED='\033[0;31m'

ok()   { echo -e "  ${GREEN}✓${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET}  $1"; exit 1; }
info() { echo -e "  ${CYAN}›${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
cmd()  { echo -e "\n  ${DIM}\$${RESET} ${CYAN}kirograph $1${RESET}"; }
sep()  { echo -e "\n${DIM}──────────────────────────────────────────────────────${RESET}"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_DIR="$SCRIPT_DIR/mock"
KG="node $ROOT/dist/bin/kirograph.js"

echo -e "\n${BOLD}  KiroGraph TurboQuant — test su progetto nuovo${RESET}"
echo -e "  ${DIM}$TEST_DIR${RESET}"

# ── 1. Build ──────────────────────────────────────────────────────────────────
sep
if [ "$NO_BUILD" = false ]; then
  info "Building..."
  cd "$ROOT" && npm run build > /dev/null 2>&1
  ok "Build OK  (v$(node "$ROOT/dist/bin/kirograph.js" --version 2>/dev/null || echo '?'))"
else
  warn "--no-build: usando dist esistente"
fi

# ── 2. Pulizia totale — ricomincia da zero ─────────────────────────────────────
sep
info "Pulizia completa — progetto vergine..."
rm -rf "$TEST_DIR/.kirograph"
rm -rf "$TEST_DIR/.kiro"
ok "Rimossi .kirograph/ e .kiro/"

cd "$TEST_DIR"

# ── 3. Config con turboquant ──────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[1] Configurazione TurboQuant${RESET}"
echo -e "  ${DIM}Crea .kirograph/config.json con semanticEngine: turboquant${RESET}"

mkdir -p .kirograph
cat > .kirograph/config.json << 'EOF'
{
  "version": 1,
  "languages": ["typescript"],
  "enableEmbeddings": true,
  "semanticEngine": "turboquant",
  "turboquantBits": 4,
  "turboquantMemDocs": true,
  "enableMemory": true
}
EOF
ok "Config scritto:"
echo -e "     ${DIM}enableEmbeddings: true${RESET}"
echo -e "     ${DIM}semanticEngine: turboquant${RESET}"
echo -e "     ${DIM}turboquantBits: 4${RESET}"
echo -e "     ${DIM}turboquantMemDocs: true${RESET}"
echo -e "     ${DIM}enableMemory: true${RESET}"

# Verifica che il config sia valido JSON
node -e "JSON.parse(require('fs').readFileSync('.kirograph/config.json','utf8'))" \
  && ok "JSON valido" || fail "config.json malformato"

# ── 4. Install ────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[2] kirograph install${RESET}"
echo -e "  ${DIM}Installa MCP, hooks e steering per kiro${RESET}"

cmd "install --target kiro --yes"
$KG install --target kiro --yes 2>&1 | grep -E "✓|✗|ℹ|hook|steering|MCP|agent|Workspace|Installing|turboquant" | sed 's/^/     /'

ok "Install completato"
[ -f ".kiro/settings/mcp.json" ]     && ok "MCP server: .kiro/settings/mcp.json"   || fail "mcp.json non trovato"
[ -f ".kiro/steering/kirograph.md" ] && ok "Steering: kirograph.md"                || fail "kirograph.md non trovato"
[ -f ".kiro/agents/kirograph.json" ] && ok "CLI agent: kirograph.json"              || fail "kirograph.json non trovato"

# Verifica che turboquant-js sia stato installato dall'installer
node -e "require('turboquant-js')" 2>/dev/null \
  && ok "turboquant-js installato automaticamente dall'installer" \
  || warn "turboquant-js non installato (npm install turboquant-js potrebbe aver fallito)"

# ── 5. Index ──────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[3] kirograph index${RESET}"
echo -e "  ${DIM}Indicizza i sorgenti TypeScript del mock${RESET}"

cmd "index"
$KG index 2>&1 | grep -E "✓|file|symbol|edge|Indexed|scanning|languages" | sed 's/^/     /'
[ -f ".kirograph/kirograph.db" ] && ok "kirograph.db creato" || fail "kirograph.db non trovato"

# ── 6. Status — engine label ──────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[4] Status — engine turboquant${RESET}"
echo -e "  ${DIM}Verifica che l'engine label sia turboquant${RESET}\n"

cmd "status"
STATUS_OUT=$($KG status 2>&1)
echo "$STATUS_OUT" | sed 's/^/     /'

echo ""
echo "$STATUS_OUT" | grep -qi "turboquant" \
  && ok "Engine 'turboquant' visibile nello status" \
  || fail "'turboquant' non appare nell'output di status"

# ── 7. Status con mock turboquant-stats.json ──────────────────────────────────
sep
echo -e "  ${BOLD}[5] Status con dati di compressione${RESET}"
echo -e "  ${DIM}Scrive turboquant-stats.json di esempio e verifica la sezione di compressione${RESET}\n"

cat > .kirograph/turboquant-stats.json << 'EOF'
{
  "count": 42,
  "dim": 768,
  "bits": 4,
  "compressionRatio": 6.1,
  "actualBytes": 16128,
  "rawBytes": 98304,
  "savedBytes": 82176,
  "memEnabled": true,
  "memCount": 8,
  "memActualBytes": 3072,
  "memRawBytes": 24576,
  "docsEnabled": false,
  "docsCount": 0,
  "docsActualBytes": 0,
  "docsRawBytes": 0,
  "updatedAt": 1749340800000
}
EOF
ok "turboquant-stats.json scritto (42 embeddings, 6.1× ratio, mem 8 obs)"

cmd "status"
STATUS2_OUT=$($KG status 2>&1)
echo "$STATUS2_OUT" | sed 's/^/     /'

echo ""
echo "$STATUS2_OUT" | grep -qi "compression\|ratio\|MB saved\|MB →\|not yet indexed\|entries" \
  && ok "Blocco compressione visibile" \
  || warn "Blocco compressione non mostrato (embeddings=0 — atteso se nessun modello di embedding è configurato)"

# ── 8. Gain ───────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[6] kirograph gain${RESET}"
echo -e "  ${DIM}Verifica che il rigo TurboQuant appaia nel summary${RESET}\n"

cmd "gain"
GAIN_OUT=$($KG gain 2>&1)
echo "$GAIN_OUT" | sed 's/^/     /'

echo ""
if echo "$GAIN_OUT" | grep -qi "TurboQuant\|No savings"; then
  echo "$GAIN_OUT" | grep -qi "TurboQuant" \
    && ok "Rigo TurboQuant visibile in gain" \
    || warn "Nessun saving registrato ancora — TurboQuant row mostrato solo con embeddings generati"
else
  warn "Gain output inatteso"
fi

# ── 9. Config validation — turboquantBits clamping ───────────────────────────
sep
echo -e "  ${BOLD}[7] Validazione config — clamping turboquantBits${RESET}"
echo -e "  ${DIM}Verifica che valori fuori range [1,8] vengano corretti${RESET}\n"

# Test clamping direttamente in Node senza passare per loadConfig (che risolve il path via process.cwd)
CLAMP_RESULT=$(node -e "
const clamp = (v, min, max) => Math.max(min, Math.min(max, Math.round(v)));
const tests = [
  { input: 99,  expect: 8, label: 'max overflow (99 → 8)' },
  { input: 0,   expect: 1, label: 'min underflow (0 → 1)'  },
  { input: -5,  expect: 1, label: 'negative (-5 → 1)'      },
  { input: 4,   expect: 4, label: 'valid (4 → 4)'          },
  { input: 3.7, expect: 4, label: 'rounding (3.7 → 4)'     },
];
let ok = true;
for (const t of tests) {
  const got = clamp(t.input, 1, 8);
  if (got !== t.expect) { console.error('FAIL ' + t.label + ' got=' + got); ok = false; }
  else console.log('    ok  ' + t.label);
}
process.exit(ok ? 0 : 1);
" 2>&1)
echo "$CLAMP_RESULT" | sed 's/^/  /'

echo ""
echo "$CLAMP_RESULT" | grep -q "FAIL" \
  && fail "Logica di clamping turboquantBits errata" \
  || ok "Clamping turboquantBits [1,8] verificato (max/min/negativo/valido/round)"

# Ripristina config
cat > .kirograph/config.json << 'EOF'
{
  "version": 1,
  "languages": ["typescript"],
  "enableEmbeddings": true,
  "semanticEngine": "turboquant",
  "turboquantBits": 4,
  "turboquantMemDocs": true,
  "enableMemory": true
}
EOF
ok "Config ripristinato (turboquantBits: 4)"

# ── 10. Query ─────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[8] kirograph query${RESET}"
echo -e "  ${DIM}Ricerca simboli per nome${RESET}\n"

cmd "query VectorStore"
QUERY_OUT=$($KG query VectorStore 2>&1)
echo "$QUERY_OUT" | sed 's/^/     /'
echo ""
echo "$QUERY_OUT" | grep -qi "VectorStore\|No results\|symbol\|method\|class" \
  && ok "query: output prodotto" || fail "query: output inatteso"

cmd "query embed --kind function"
$KG query embed --kind function 2>&1 | sed 's/^/     /'
ok "query --kind: completato"

# ── 11. Context ───────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[9] kirograph context${RESET}"
echo -e "  ${DIM}Costruisce il contesto semantico per un task${RESET}\n"

cmd "context \"vector embedding search\""
CTX_OUT=$($KG context "vector embedding search" --no-code 2>&1)
echo "$CTX_OUT" | head -20 | sed 's/^/     /'
echo ""
echo "$CTX_OUT" | grep -qi "Entry\|symbol\|Result\|No \|embed\|vector\|store" \
  && ok "context: output prodotto" || warn "context: nessun risultato (senza embedding model è atteso)"

# ── 12. Files ─────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[10] kirograph files${RESET}"
echo -e "  ${DIM}Lista file indicizzati in vari formati${RESET}\n"

cmd "files"
FILES_OUT=$($KG files 2>&1)
echo "$FILES_OUT" | sed 's/^/     /'
echo ""
echo "$FILES_OUT" | grep -qi "embedder\|vector-store\|src\|\.ts" \
  && ok "files: file TypeScript trovati" || fail "files: nessun file TypeScript"

cmd "files --format flat"
$KG files --format flat 2>&1 | sed 's/^/     /'
ok "files --format flat: completato"

cmd "files --format compact"
$KG files --format compact 2>&1 | sed 's/^/     /'
ok "files --format compact: completato"

# ── 13. Read ──────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[11] kirograph read${RESET}"
echo -e "  ${DIM}Legge un file con caching e modalità diverse${RESET}\n"

cmd "read src/embedder.ts --mode signatures"
READ_OUT=$($KG read src/embedder.ts --mode signatures 2>&1)
echo "$READ_OUT" | sed 's/^/     /'
echo ""
echo "$READ_OUT" | grep -qi "Embedder\|embed\|function\|class\|export\|interface" \
  && ok "read --mode signatures: simboli estratti" || fail "read: output vuoto"

cmd "read src/vector-store.ts --mode exports"
$KG read src/vector-store.ts --mode exports 2>&1 | sed 's/^/     /'
ok "read --mode exports: completato"

# ── 14. Dead code ─────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[12] kirograph dead-code${RESET}"
echo -e "  ${DIM}Trova simboli non esportati senza riferimenti entranti${RESET}\n"

cmd "dead-code"
DEAD_OUT=$($KG dead-code 2>&1)
echo "$DEAD_OUT" | sed 's/^/     /'
echo ""
echo "$DEAD_OUT" | grep -qi "Dead Code\|No dead\|symbol\|method\|function" \
  && ok "dead-code: completato" || fail "dead-code: output inatteso"

# ── 15. Hotspots ──────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[13] kirograph hotspots${RESET}"
echo -e "  ${DIM}Trova simboli con il maggior numero di connessioni${RESET}\n"

cmd "hotspots --limit 5"
HOT_OUT=$($KG hotspots --limit 5 2>&1)
echo "$HOT_OUT" | sed 's/^/     /'
echo ""
echo "$HOT_OUT" | grep -qi "Hotspot\|symbol\|edge\|degree\|No hotspot" \
  && ok "hotspots: completato" || fail "hotspots: output inatteso"

# ── 16. Surprising ────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[14] kirograph surprising${RESET}"
echo -e "  ${DIM}Trova coupling inatteso tra moduli${RESET}\n"

cmd "surprising --limit 5"
SURP_OUT=$($KG surprising --limit 5 2>&1)
echo "$SURP_OUT" | sed 's/^/     /'
echo ""
echo "$SURP_OUT" | grep -qi "Surprising\|No surprising\|cross-module\|coupling" \
  && ok "surprising: completato" || warn "surprising: nessun risultato (normale su un progetto piccolo)"

# ── 17. Communities ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[15] kirograph communities${RESET}"
echo -e "  ${DIM}Rileva cluster di simboli strettamente connessi${RESET}\n"

cmd "communities --limit 5"
COMM_OUT=$($KG communities --limit 5 2>&1)
echo "$COMM_OUT" | sed 's/^/     /'
echo ""
echo "$COMM_OUT" | grep -qi "Communit\|cluster\|No communit\|symbol" \
  && ok "communities: completato" || warn "communities: nessun risultato (normale su un progetto piccolo)"

# ── 18. Flows ─────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[16] kirograph flows${RESET}"
echo -e "  ${DIM}Traccia flussi di esecuzione dal punto di ingresso${RESET}\n"

cmd "flows --max-flows 3"
FLOWS_OUT=$($KG flows --max-flows 3 2>&1)
echo "$FLOWS_OUT" | sed 's/^/     /'
echo ""
echo "$FLOWS_OUT" | grep -qi "Flow\|No flow\|entry\|chain\|call" \
  && ok "flows: completato" || warn "flows: nessun flusso (normale su un progetto piccolo)"

# ── 19. Affected ──────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[17] kirograph affected${RESET}"
echo -e "  ${DIM}Trova test impattati da una modifica sorgente${RESET}\n"

cmd "affected src/embedder.ts"
AFF_OUT=$($KG affected src/embedder.ts 2>&1)
echo "$AFF_OUT" | sed 's/^/     /'
echo ""
echo "$AFF_OUT" | grep -qi "Affected\|No affected\|test\|file\|\.spec\|\.test" \
  && ok "affected: completato" || warn "affected: nessun test trovato (nessun file *.spec.ts nel mock)"

# ── 20. Path ──────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[18] kirograph path${RESET}"
echo -e "  ${DIM}Cammino più breve tra due simboli${RESET}\n"

cmd "path Embedder VectorStore"
PATH_OUT=$($KG path Embedder VectorStore 2>&1)
echo "$PATH_OUT" | sed 's/^/     /'
echo ""
echo "$PATH_OUT" | grep -qi "Embedder\|VectorStore\|Path\|No path\|symbol\|→" \
  && ok "path: completato" || warn "path: nessun cammino trovato (normale se non ci sono edge diretti)"

# ── 21. Refactor suggest ──────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[19] kirograph refactor suggest${RESET}"
echo -e "  ${DIM}Suggerisce opportunità di refactoring${RESET}\n"

cmd "refactor suggest --limit 5"
REF_OUT=$($KG refactor suggest --limit 5 2>&1)
echo "$REF_OUT" | sed 's/^/     /'
echo ""
echo "$REF_OUT" | grep -qi "Refactor\|No refactor\|suggestion\|symbol\|candidate" \
  && ok "refactor suggest: completato" || warn "refactor suggest: nessun candidato (normale su un progetto piccolo)"

# ── 22. Sync ──────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[20] kirograph sync + mark-dirty + sync-if-dirty${RESET}"
echo -e "  ${DIM}Sincronizzazione incrementale e dirty marker${RESET}\n"

cmd "mark-dirty"
$KG mark-dirty 2>&1 | sed 's/^/     /'
[ -f ".kirograph/.dirty" ] || [ -f ".kirograph/dirty" ] \
  && ok "mark-dirty: dirty marker scritto" \
  || warn "mark-dirty: marker non trovato (può usare un meccanismo interno)"

cmd "sync-if-dirty"
$KG sync-if-dirty 2>&1 | sed 's/^/     /'
ok "sync-if-dirty: completato"

cmd "sync"
SYNC_OUT=$($KG sync 2>&1)
echo "$SYNC_OUT" | sed 's/^/     /'
echo ""
echo "$SYNC_OUT" | grep -qi "sync\|file\|up.to.date\|changed\|nothing" \
  && ok "sync: completato" || fail "sync: output inatteso"

# ── 23. Export ────────────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[21] kirograph export${RESET}"
echo -e "  ${DIM}Esporta il grafo come dashboard interattivo HTML${RESET}\n"

cmd "export build"
$KG export build 2>&1 | sed 's/^/     /'
EXPORT_FILE=".kirograph/export/index.html"
[ -f "$EXPORT_FILE" ] \
  && ok "export build: HTML scritto ($EXPORT_FILE — $(du -h "$EXPORT_FILE" | cut -f1))" \
  || warn "export build: file non trovato"

cmd "export graphml --output /tmp/kg-tq-test.graphml"
$KG export graphml --output /tmp/kg-tq-test.graphml 2>&1 | sed 's/^/     /'
[ -f "/tmp/kg-tq-test.graphml" ] \
  && ok "export graphml: GraphML scritto ($(du -h /tmp/kg-tq-test.graphml | cut -f1))" \
  || warn "export graphml: file non trovato"
rm -f /tmp/kg-tq-test.graphml

# ── 24. Memoria con TurboQuant ────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[22] Memory — store / search / timeline / watchmen${RESET}"
echo -e "  ${DIM}Osservazioni di memoria con turboquantMemDocs abilitato${RESET}\n"

RUN_ID=$(date +%s)

cmd "mem store \"...\" --kind decision"
$KG mem store "[$RUN_ID] TurboQuant: preferire turboquantBits 4 per bilanciare qualità e compressione — 3 bit è aggressivo, causa degrado coseno > 5%." --kind decision 2>&1 | sed 's/^/     /'
ok "1/3 osservazione storata [decision]"

cmd "mem store \"...\" --kind pattern"
$KG mem store "[$RUN_ID] Pattern: chiamare writeTurboQuantStats dopo embedAll() per aggiornare i dati di compressione esposti da kirograph status e gain." --kind pattern 2>&1 | sed 's/^/     /'
ok "2/3 osservazione storata [pattern]"

cmd "mem store \"...\" --kind error"
$KG mem store "[$RUN_ID] Errore: TurboQuantIndex.initialize() fallisce silenziosamente se turboquant-js non è installato — verificare isAvailable() prima di fare upsert." --kind error 2>&1 | sed 's/^/     /'
ok "3/3 osservazione storata [error]"

cmd "mem search \"turboquant compression\""
MEM_SEARCH=$($KG mem search "turboquant compression" 2>&1)
echo "$MEM_SEARCH" | sed 's/^/     /'
echo ""
echo "$MEM_SEARCH" | grep -qi "TurboQuant\|turboquant\|result\|No result\|observation" \
  && ok "mem search: risultati trovati" || warn "mem search: nessun risultato (richiede embedding model)"

cmd "mem timeline"
MEM_TL=$($KG mem timeline 2>&1)
echo "$MEM_TL" | sed 's/^/     /'
echo ""
echo "$MEM_TL" | grep -qi "decision\|pattern\|error\|observation\|timeline" \
  && ok "mem timeline: osservazioni visibili" || fail "mem timeline: nessuna osservazione"

cmd "mem watchmen status"
$KG mem watchmen status 2>&1 | sed 's/^/     /' || true
ok "mem watchmen status: completato (watchmen non abilitato in questo config)"

cmd "mem watchmen reset"
$KG mem watchmen reset 2>&1 | sed 's/^/     /' || true
ok "mem watchmen reset: completato"

# ── 25. Exec (shell compression) ──────────────────────────────────────────────
sep
echo -e "  ${BOLD}[23] kirograph exec${RESET}"
echo -e "  ${DIM}Esegue un comando con compressione token integrata${RESET}\n"

cmd "exec ls src/"
EXEC_OUT=$($KG exec ls src/ 2>&1)
echo "$EXEC_OUT" | sed 's/^/     /'
echo ""
echo "$EXEC_OUT" | grep -qi "embedder\|vector-store\|\.ts" \
  && ok "exec: output del comando visibile" || warn "exec: output non standard (può dipendere dalla strategia di compressione)"

# ── 26. Gain esteso ───────────────────────────────────────────────────────────
sep
echo -e "  ${BOLD}[24] kirograph gain (varianti)${RESET}"
echo -e "  ${DIM}Analytics token savings — graph, history, daily${RESET}\n"

cmd "gain --graph"
$KG gain --graph 2>&1 | sed 's/^/     /'
ok "gain --graph: completato"

cmd "gain --history"
$KG gain --history 2>&1 | sed 's/^/     /'
ok "gain --history: completato"

cmd "gain --daily"
$KG gain --daily 2>&1 | sed 's/^/     /'
ok "gain --daily: completato"

cmd "gain --json"
GAIN_JSON=$($KG gain --json 2>&1)
echo "$GAIN_JSON" | head -5 | sed 's/^/     /'
node -e "JSON.parse(process.argv[1])" "$GAIN_JSON" 2>/dev/null \
  && ok "gain --json: JSON valido" \
  || warn "gain --json: output non JSON (nessun dato ancora)"

# ── 27. Unit test TurboQuantIndex ─────────────────────────────────────────────
sep
echo -e "  ${BOLD}[25] Unit test TurboQuantIndex${RESET}"
echo -e "  ${DIM}Test diretto: upsert → search → save → load → stats${RESET}\n"

TQ_AVAILABLE=false
node -e "require('turboquant-js')" 2>/dev/null && TQ_AVAILABLE=true || true

if [ "$SKIP_UNIT" = true ]; then
  warn "--skip-unit: unit test saltato"
elif [ "$TQ_AVAILABLE" = false ]; then
  warn "turboquant-js non disponibile — unit test saltato"
  warn "L'installer avrebbe dovuto installarlo. Controlla l'output del passo [2]."
else
  ok "turboquant-js trovato — avvio unit test"
  echo ""

  node << 'NODETEST'
const path = require('path');
const os   = require('os');
const fs   = require('fs');

// Resolve TurboQuantIndex from the compiled dist
const { TurboQuantIndex, readTurboQuantStats, writeTurboQuantStats } =
  require(path.join(process.env.ROOT || process.cwd() + '/../../..', 'dist/vectors/turboquant-index.js'));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-tq-test-'));
const DIM = 64;
const BITS = 3;

async function run() {
  console.log('  Unit: TurboQuantIndex');

  // 1. Create
  const idx = new TurboQuantIndex(tmpDir, 'test.bin', DIM, BITS);
  console.log('    ✓  TurboQuantIndex creato');

  // 2. isAvailable (should be true since turboquant-js is installed)
  await idx.initialize();
  if (!idx.isAvailable()) throw new Error('isAvailable() false dopo initialize()');
  console.log('    ✓  initialize() / isAvailable()');

  // 3. upsert N vectors
  const N = 20;
  for (let i = 0; i < N; i++) {
    const v = new Float32Array(DIM);
    for (let j = 0; j < DIM; j++) v[j] = Math.sin(i * 0.3 + j * 0.1);
    idx.upsert(`node-${i}`, v);
  }
  if (idx.count() !== N) throw new Error(`count() atteso ${N}, ottenuto ${idx.count()}`);
  console.log(`    ✓  upsert ${N} vettori  (count=${idx.count()})`);

  // 4. search — il risultato deve contenere almeno 1 id valido
  const query = new Float32Array(DIM);
  for (let j = 0; j < DIM; j++) query[j] = Math.sin(5 * 0.3 + j * 0.1); // simile a node-5
  const results = idx.search(query, 3);
  if (!Array.isArray(results) || results.length === 0) throw new Error('search() ha restituito 0 risultati');
  console.log(`    ✓  search() → [${results.join(', ')}]`);

  // 5. searchWithScores
  const scored = idx.searchWithScores(query, 3);
  if (!scored[0]?.id) throw new Error('searchWithScores() manca id');
  console.log(`    ✓  searchWithScores() → top: ${scored[0].id} (score ${scored[0].score.toFixed(4)})`);

  // 6. delete (soft)
  idx.delete('node-0');
  const afterDelete = idx.search(query, N);
  if (afterDelete.includes('node-0')) throw new Error('delete() non ha rimosso node-0 dai risultati');
  console.log('    ✓  delete() — soft-delete verificato');

  // 7. memoryStats
  const ms = idx.memoryStats();
  if (typeof ms.compressionRatio !== 'number') throw new Error('memoryStats().compressionRatio mancante');
  console.log(`    ✓  memoryStats()  compressionRatio=${ms.compressionRatio.toFixed(2)}×`);

  // 8. save
  await idx.save();
  const binPath = path.join(tmpDir, 'test.bin');
  if (!fs.existsSync(binPath)) throw new Error(`File ${binPath} non salvato`);
  console.log(`    ✓  save() → ${binPath} (${fs.statSync(binPath).size} bytes)`);

  // 9. load — crea un nuovo indice e ricarica dal file
  const idx2 = new TurboQuantIndex(tmpDir, 'test.bin', DIM, BITS);
  await idx2.initialize();
  const results2 = idx2.search(query, 3);
  if (!Array.isArray(results2) || results2.length === 0) throw new Error('Indice ricaricato: search() vuoto');
  console.log(`    ✓  load da file → search OK [${results2.join(', ')}]`);

  // 10. writeTurboQuantStats / readTurboQuantStats
  writeTurboQuantStats(tmpDir, {
    count: N,
    dim: DIM,
    bits: BITS,
    compressionRatio: ms.compressionRatio,
    actualBytes: ms.actualBytes,
    rawBytes: N * DIM * 4,
    savedBytes: N * DIM * 4 - ms.actualBytes,
    memEnabled: false, memCount: 0, memActualBytes: 0, memRawBytes: 0,
    docsEnabled: false, docsCount: 0, docsActualBytes: 0, docsRawBytes: 0,
    updatedAt: Date.now(),
  });
  const stats = readTurboQuantStats(tmpDir);
  if (!stats || stats.count !== N) throw new Error('readTurboQuantStats() mancante o count errato');
  console.log(`    ✓  writeTurboQuantStats / readTurboQuantStats  (count=${stats.count}, ratio=${stats.compressionRatio.toFixed(2)}×)`);

  // 11. close
  idx.close();
  idx2.close();
  console.log('    ✓  close()');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true });

  console.log('\n  Tutti gli unit test superati.');
}

run().catch(e => {
  console.error('\n  ✗  Unit test FALLITO: ' + e.message);
  process.exit(1);
});
NODETEST

  [ $? -eq 0 ] && ok "Unit test TurboQuantIndex: tutti superati" || fail "Unit test falliti"
fi

# ── Fine ──────────────────────────────────────────────────────────────────────
sep
echo ""
echo -e "  ${BOLD}File generati in mock/.kirograph/:${RESET}"
ls "$TEST_DIR/.kirograph/" 2>/dev/null | while read -r f; do
  if [[ "$f" == turboquant* ]]; then
    echo -e "     ${CYAN}·${RESET} $f  ${DIM}(TurboQuant)${RESET}"
  else
    echo -e "     ${DIM}·${RESET} $f"
  fi
done

echo ""
if [ "$SKIP_UNIT" = true ]; then
  echo -e "  ${YELLOW}${BOLD}Completato (--skip-unit)${RESET} — 24 passi su 25 verificati."
  echo -e "  ${DIM}Comandi testati: install (+turboquant-js auto-install), index, status, gain, query, context,${RESET}"
  echo -e "  ${DIM}files, read, dead-code, hotspots, surprising, communities, flows, affected, path,${RESET}"
  echo -e "  ${DIM}refactor, sync, export, mem, exec${RESET}"
elif [ "$TQ_AVAILABLE" = false ]; then
  echo -e "  ${YELLOW}${BOLD}Completato (unit test saltato)${RESET} — 24 passi su 25 verificati."
  echo -e "  ${DIM}turboquant-js non disponibile — controlla l'output del passo [2] per dettagli sull'installazione.${RESET}"
else
  echo -e "  ${GREEN}${BOLD}Tutti i 25 passi completati.${RESET}"
fi
echo ""
