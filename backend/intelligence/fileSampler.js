import path from "node:path";

export function sampleStratifiedFiles(filesWithAST = []) {
  // 1. Build import centrality score
  const importCounts = new Map();
  for (const f of filesWithAST) {
    importCounts.set(f.filePath, 0);
  }

  for (const f of filesWithAST) {
    for (const imp of f.imports || []) {
      for (const targetPath of importCounts.keys()) {
        const baseName = path.basename(targetPath, path.extname(targetPath));
        if (imp.includes(baseName)) {
          importCounts.set(targetPath, (importCounts.get(targetPath) || 0) + 1);
        }
      }
    }
  }

  // 2. Classify into architectural layers
  const buckets = {
    controllers_routes: [],
    services: [],
    models_repos: [],
    errors_middleware: [],
    tests: [],
    general: []
  };

  for (const f of filesWithAST) {
    const lower = f.filePath.toLowerCase();
    const centrality = importCounts.get(f.filePath) || 0;
    const nodeCount = (f.nodes || []).length;
    const score = centrality * 2 + nodeCount;
    const item = { ...f, centrality, score };

    if (/(test|spec|\.test\.|\.spec\.)/.test(lower)) {
      buckets.tests.push(item);
    } else if (/(controller|route|router|api|handler|endpoint)/.test(lower)) {
      buckets.controllers_routes.push(item);
    } else if (/(service|manager|usecase|interactor|client)/.test(lower)) {
      buckets.services.push(item);
    } else if (/(model|repo|repository|schema|entity|dao)/.test(lower)) {
      buckets.models_repos.push(item);
    } else if (/(error|middleware|exception|guard|interceptor|util|helper)/.test(lower)) {
      buckets.errors_middleware.push(item);
    } else {
      buckets.general.push(item);
    }
  }

  // Sort each bucket by centrality score
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => b.score - a.score);
  }

  // 3. Take stratified samples (up to 15 total)
  const quota = {
    controllers_routes: 2,
    services: 3,
    models_repos: 2,
    errors_middleware: 3,
    tests: 2,
    general: 3
  };

  const selectedFiles = [];
  const selectedPaths = new Set();

  for (const [layer, maxCount] of Object.entries(quota)) {
    const candidates = buckets[layer] || [];
    for (const cand of candidates.slice(0, maxCount)) {
      if (!selectedPaths.has(cand.filePath)) {
        selectedPaths.add(cand.filePath);
        selectedFiles.push(cand);
      }
    }
  }

  // If we have fewer than 8 files and there are other files, fill from general
  if (selectedFiles.length < 8) {
    for (const cand of buckets.general) {
      if (!selectedPaths.has(cand.filePath) && selectedFiles.length < 15) {
        selectedPaths.add(cand.filePath);
        selectedFiles.push(cand);
      }
    }
  }

  // 4. Return compact AST summaries instead of raw code to preserve context window
  return selectedFiles.map((file) => ({
    filePath: file.filePath,
    language: file.language,
    totalLines: file.totalLines,
    centralityScore: file.centrality,
    nodesSummary: (file.nodes || []).map((n) => ({
      symbolPath: n.symbolPath,
      type: n.type,
      startLine: n.startLine,
      endLine: n.endLine,
      signatures: n.signatures
    })),
    // retain raw nodes for exemplar extraction
    rawNodes: file.nodes || []
  }));
}
