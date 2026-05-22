/**
 * KiroGraph Installer — configuration prompting
 */

import * as readline from 'readline';
import { KiroGraphConfig } from '../../config';
type CavemanMode = 'lite' | 'full' | 'ultra';
import { ask, askToggle, arrowSelect, printSection, printSeparator, dim, reset, violet } from './prompts';
export type ConfigPatch = Pick<KiroGraphConfig, 'enableEmbeddings' | 'useVecIndex' | 'semanticEngine' | 'typesenseDashboard' | 'qdrantDashboard' | 'extractDocstrings' | 'trackCallSites' | 'enableArchitecture' | 'cavemanMode' | 'shellCompressionLevel' | 'enableMemory'> & { embeddingModel?: string; embeddingDim?: number };
export type SemanticEngine = KiroGraphConfig['semanticEngine'];

export const DEFAULT_EMBEDDING_MODEL = 'nomic-ai/nomic-embed-text-v1.5';

/** Well-known embedding models with their output dimensions. */
const PRESET_MODELS = [
  {
    value: 'nomic-ai/nomic-embed-text-v1.5',
    label: 'nomic-embed-text-v1.5',
    dim: 768,
    description: '768-dim · ~130MB · Best quality for code search  (recommended)',
  },
  {
    value: 'onnx-community/embeddinggemma-300m-ONNX',
    label: 'embeddinggemma-300m',
    dim: 768,
    description: '768-dim · ~300MB · Google Gemma-based, multilingual, 2048-token context',
  },
  {
    value: 'Xenova/all-MiniLM-L6-v2',
    label: 'all-MiniLM-L6-v2',
    dim: 384,
    description: '384-dim · ~23MB  · Fast and lightweight, lower accuracy',
  },
  {
    value: 'BAAI/bge-base-en-v1.5',
    label: 'bge-base-en-v1.5',
    dim: 768,
    description: '768-dim · ~110MB · Strong general-purpose alternative to nomic',
  },
  {
    value: '__other__',
    label: 'Other',
    dim: 768,
    description: 'Enter a custom HuggingFace model ID and embedding dimension',
  },
] as const;

export async function promptConfigOptions(rl: readline.Interface): Promise<ConfigPatch> {
  // ── Semantic Search ─────────────────────────────────────────────────────────
  printSection('🔍', 'Semantic Search');

  const enableEmbeddings = await askToggle(
    rl,
    'Semantic embeddings (similarity search):',
    'Enables natural-language code search via vector embeddings. A local model (~130MB) is downloaded on first use.',
  );

  const patch: ConfigPatch = { enableEmbeddings, useVecIndex: false, semanticEngine: 'cosine', typesenseDashboard: false, qdrantDashboard: false, extractDocstrings: true, trackCallSites: true, enableArchitecture: false, cavemanMode: 'off', shellCompressionLevel: 'normal', enableMemory: false };

  if (enableEmbeddings) {
    // ── Model selection ────────────────────────────────────────────────────────
    const modelChoice = await arrowSelect<string>(
      rl,
      'Embedding model:',
      PRESET_MODELS.map(m => ({ value: m.value, label: m.label, description: m.description })),
    );

    let embeddingModel: string;
    let embeddingDim: number;

    if (modelChoice === '__other__') {
      console.log(`\n  ${dim}Enter a HuggingFace model ID in the format org/model-name.${reset}`);
      while (true) {
        const raw = (await ask(rl, `  ${violet}Model identifier:${reset} `)).trim();
        if (raw.includes('/')) { embeddingModel = raw; break; }
        console.log(`  Expected a HuggingFace model ID in the format org/model-name (e.g. nomic-ai/nomic-embed-text-v1.5).`);
      }
      console.log(`\n  ${dim}Enter the embedding output dimension for this model (check the model card on HuggingFace).${reset}`);
      while (true) {
        const raw = (await ask(rl, `  ${violet}Embedding dimension (e.g. 768, 384):${reset} `)).trim();
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n > 0) { embeddingDim = n; break; }
        console.log(`  Expected a positive integer (e.g. 768, 384, 1536).`);
      }
    } else {
      const preset = PRESET_MODELS.find(m => m.value === modelChoice)!;
      embeddingModel = preset.value;
      embeddingDim = preset.dim;
    }

    patch.embeddingModel = embeddingModel;
    patch.embeddingDim = embeddingDim;

    // ── Engine selection ───────────────────────────────────────────────────────
    const semanticEngine = await arrowSelect<SemanticEngine>(rl, 'Vector search engine:', [
      { value: 'cosine',     label: 'cosine',     description: 'In-process cosine similarity. No extra deps. Best for small/medium projects.' },
      { value: 'sqlite-vec', label: 'sqlite-vec', description: 'ANN index. Sub-linear search. Best for large codebases. Needs: better-sqlite3, sqlite-vec (native).' },
      { value: 'orama',      label: 'orama',      description: 'Hybrid search (full-text + vector). Pure JS. Needs: @orama/orama, @orama/plugin-data-persistence.' },
      { value: 'pglite',     label: 'pglite',     description: 'Hybrid search via PostgreSQL + pgvector. Exact results. Pure WASM. Needs: @electric-sql/pglite.' },
      { value: 'lancedb',    label: 'lancedb',    description: 'ANN search via LanceDB (Apache Lance columnar format). Pure JS. Needs: @lancedb/lancedb.' },
      { value: 'qdrant',     label: 'qdrant',     description: 'ANN search via Qdrant embedded binary (HNSW index, Cosine). Needs: qdrant-local.' },
      { value: 'typesense',  label: 'typesense',  description: 'ANN search via Typesense (auto-downloaded binary, HNSW, Cosine). Needs: typesense.' },
    ]);
    patch.semanticEngine = semanticEngine;
    patch.useVecIndex = semanticEngine === 'sqlite-vec';

    if (semanticEngine === 'typesense') {
      patch.typesenseDashboard = await askToggle(rl,
        'Typesense dashboard:',
        'Serves the Typesense Dashboard locally and opens it in your browser after indexing completes.',
        false,
      );
    }

    if (semanticEngine === 'qdrant') {
      patch.qdrantDashboard = await askToggle(rl,
        'Qdrant dashboard:',
        'Downloads the Qdrant Web UI (first time only) and opens it in your browser after indexing completes.',
        false,
      );
    }
  }

  // ── Graph Features ──────────────────────────────────────────────────────────
  printSection('📊', 'Graph Features');

  patch.extractDocstrings = await askToggle(rl,
    'Docstring extraction:',
    'Enriches symbol metadata and improves context quality. Slightly increases indexing time.',
  );

  patch.trackCallSites = await askToggle(rl,
    'Call site tracking (caller/callee graph):',
    'Enables kirograph_callers and kirograph_callees MCP tools. Increases index size.',
  );

  patch.enableArchitecture = await askToggle(rl,
    'Architecture analysis (packages + layers):',
    'Detects packages from manifests and architectural layers. Enables kirograph_architecture, kirograph_coupling, kirograph_package.',
    false,
  );

  // ── Agent Behavior ──────────────────────────────────────────────────────────
  printSection('🤖', 'Agent Behavior');

  const cavemanChoice = await arrowSelect(rl, 'Communication style (caveman mode):', [
    { value: 'off',   label: 'off',   description: 'Normal responses — no compression' },
    { value: 'lite',  label: 'lite',  description: 'Compact, no filler, full sentences' },
    { value: 'full',  label: 'full',  description: 'Fragments, no articles, short synonyms' },
    { value: 'ultra', label: 'ultra', description: 'Max compression, abbreviations, → for causality' },
  ]);
  patch.cavemanMode = cavemanChoice as CavemanMode | 'off';

  const compressionChoice = await arrowSelect(rl, 'Shell compression (kirograph_exec default level):', [
    { value: 'off',        label: 'off',        description: 'No compression hook or steering (tool still available)' },
    { value: 'normal',     label: 'normal',     description: 'Balanced: removes noise, keeps structure (recommended)' },
    { value: 'aggressive', label: 'aggressive', description: 'More compact: groups by category, limits output' },
    { value: 'ultra',      label: 'ultra',      description: 'Maximum compression: counts and summaries only' },
  ]);
  patch.shellCompressionLevel = compressionChoice as KiroGraphConfig['shellCompressionLevel'];

  // ── Memory ──────────────────────────────────────────────────────────────────
  printSection('🧠', 'Memory');

  (patch as any).enableMemory = await askToggle(rl,
    'Persistent memory (cross-session observations):',
    'Stores decisions, errors, and patterns across sessions. Compressed (if caveman is on), linked to code symbols, searchable via kirograph_mem_* tools. Zero LLM tokens on write.',
    false, // Requires explicit enable
  );

  return patch;
}
