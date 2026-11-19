import Parser from "web-tree-sitter";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find tree-sitter-wasms directory
const wasmDir = path.resolve(__dirname, "../../node_modules/tree-sitter-wasms/out");

let parserInitialized = false;
const loadedLanguages = new Map();

export async function initParser() {
  if (!parserInitialized) {
    await Parser.init();
    parserInitialized = true;
  }
}

function resolveLanguageName(filePath, runtime) {
  if (runtime) {
    if (runtime === "javascript") return "javascript";
    if (runtime === "typescript") return "typescript";
    if (runtime === "python") return "python";
    if (runtime === "cpp") return "cpp";
    if (runtime === "java") return "java";
  }

  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".jsx":
      return "javascript";
    case ".ts":
    case ".mts":
    case ".cts":
    case ".tsx":
      return "typescript";
    case ".py":
      return "python";
    case ".cpp":
    case ".cc":
    case ".cxx":
    case ".hpp":
    case ".h":
      return "cpp";
    case ".java":
      return "java";
    default:
      return null;
  }
}

export async function getLanguageParser(language) {
  await initParser();
  if (loadedLanguages.has(language)) {
    return loadedLanguages.get(language);
  }

  const wasmPath = path.join(wasmDir, `tree-sitter-${language}.wasm`);
  try {
    const Lang = await Parser.Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(Lang);
    const item = { parser, Lang, language };
    loadedLanguages.set(language, item);
    return item;
  } catch (err) {
    console.error(`[astParser] Failed to load parser for language ${language}:`, err.message);
    return null;
  }
}

// Language S-Expression Queries
const LANGUAGE_QUERIES = {
  javascript: `
    (class_declaration name: (identifier) @class.name) @class.def
    (method_definition name: (property_identifier) @method.name) @method.def
    (function_declaration name: (identifier) @func.name) @func.def
    (arrow_function) @arrow.def
    (try_statement (catch_clause) @catch.clause) @try.block
    (throw_statement) @throw.stmt
    (import_statement) @import.stmt
  `,
  typescript: `
    (class_declaration name: (type_identifier) @class.name) @class.def
    (interface_declaration name: (type_identifier) @interface.name) @interface.def
    (method_definition name: (property_identifier) @method.name) @method.def
    (function_declaration name: (identifier) @func.name) @func.def
    (arrow_function) @arrow.def
    (try_statement (catch_clause) @catch.clause) @try.block
    (throw_statement) @throw.stmt
    (import_statement) @import.stmt
  `,
  python: `
    (class_definition name: (identifier) @class.name) @class.def
    (function_definition name: (identifier) @func.name) @func.def
    (try_statement (except_clause) @except.clause) @try.block
    (raise_statement) @raise.stmt
    (import_statement) @import.stmt
    (import_from_statement) @import.stmt
  `,
  java: `
    (class_declaration name: (identifier) @class.name) @class.def
    (interface_declaration name: (identifier) @interface.name) @interface.def
    (constructor_declaration name: (identifier) @constructor.name) @constructor.def
    (method_declaration name: (identifier) @method.name) @method.def
    (try_statement (catch_clause) @catch.clause) @try.block
    (throw_statement) @throw.stmt
    (import_declaration) @import.stmt
  `,
  cpp: `
    (class_specifier name: (type_identifier) @class.name) @class.def
    (struct_specifier name: (type_identifier) @struct.name) @struct.def
    (function_definition declarator: (function_declarator declarator: (identifier) @func.name)) @func.def
    (function_definition declarator: (function_declarator declarator: (field_identifier) @method.name)) @method.def
    (try_statement (catch_clause) @catch.clause) @try.block
    (throw_expression) @throw.stmt
    (preproc_include) @import.stmt
  `
};

function analyzeCodeSignatures(code, language) {
  const signatures = {
    hasEarlyReturn: false,
    errorPattern: "none",
    validationLibrary: "none",
    hasDependencyInjection: false,
    isAsync: false
  };

  if (!code) return signatures;

  // Early return detection (guard clause pattern)
  // Look for if (...) return ... before lines of logic
  const guardRegex = /if\s*\([^)]+\)\s*\{\s*(return|throw)[^;]*;\s*\}|if\s*\([^)]+\)\s*(return|throw)\b/i;
  const pythonGuardRegex = /if\s+[^:]+:\s*(return|raise)\b/i;
  signatures.hasEarlyReturn = (language === "python" ? pythonGuardRegex : guardRegex).test(code);

  // Async detection
  signatures.isAsync = /\basync\b|\bPromise<|\bDeferred\b|\bFuture</.test(code);

  // Validation library detection
  if (/\bz\.(string|number|object|array|boolean|infer|parse|safeParse)\b/.test(code)) {
    signatures.validationLibrary = "zod";
  } else if (/\bBaseModel\b|\bField\(|\bpydantic\b/.test(code)) {
    signatures.validationLibrary = "pydantic";
  } else if (/\bJoi\.(object|string|number)\b/.test(code)) {
    signatures.validationLibrary = "joi";
  } else if (/\byup\.(object|string|number)\b/.test(code)) {
    signatures.validationLibrary = "yup";
  } else if (signatures.hasEarlyReturn) {
    signatures.validationLibrary = "manual_guard";
  }

  // Error pattern detection
  if (/throw\s+new\s+(?:AppError|HttpError|ApiError|ValidationError|BadRequestError|NotFoundError|[A-Z][a-zA-Z]*Error)\s*\(/.test(code)) {
    signatures.errorPattern = "throws_custom_error";
  } else if (/throw\s+new\s+Error\s*\(/.test(code) || /raise\s+[A-Za-z0-9_]*Error\s*\(/.test(code)) {
    signatures.errorPattern = "throws_standard_error";
  } else if (/return\s*\{\s*(?:ok|success|isSuccess)\s*:\s*(?:false|true)/.test(code) || /Result<(?:[A-Za-z0-9_,\s]+)>/.test(code)) {
    signatures.errorPattern = "returns_result_object";
  } else if (/try\s*\{/.test(code) && /catch\s*\(/.test(code)) {
    signatures.errorPattern = "try_catch_wrapped";
  } else if (/try:/.test(code) && /except(\s+[A-Za-z0-9_]+)?:/.test(code)) {
    signatures.errorPattern = "try_except_wrapped";
  }

  // Dependency injection detection (constructor storing parameters onto this or fields)
  if (/constructor\s*\(([^)]+)\)\s*\{[^}]*this\.[a-zA-Z0-9_]+\s*=\s*/.test(code) ||
      /def\s+__init__\s*\(\s*self\s*,\s*[^)]+\):[^:]*self\.[a-zA-Z0-9_]+\s*=/.test(code) ||
      /@Autowired|public\s+[A-Z][a-zA-Z0-9_]+\s*\([^)]+\)\s*\{[^}]*this\./.test(code)) {
    signatures.hasDependencyInjection = true;
  }

  return signatures;
}

export async function parseFileAST(filePath, content = "", runtime = null) {
  const language = resolveLanguageName(filePath, runtime);
  if (!language) {
    return { filePath, language: "unknown", nodes: [], imports: [], error: "Unsupported language" };
  }

  const langPack = await getLanguageParser(language);
  if (!langPack) {
    return { filePath, language, nodes: [], imports: [], error: `Parser unavailable for ${language}` };
  }

  const { parser, Lang } = langPack;
  const tree = parser.parse(content);
  const rootNode = tree.rootNode;
  const queryString = LANGUAGE_QUERIES[language];

  if (!queryString) {
    return { filePath, language, nodes: [], imports: [] };
  }

  const query = Lang.query(queryString);
  const captures = query.captures(rootNode);

  const nodes = [];
  const imports = [];
  const processedRanges = new Set();

  let currentClassName = "";

  for (let i = 0; i < captures.length; i++) {
    const capture = captures[i];
    const { name, node } = capture;
    const rangeKey = `${node.startIndex}-${node.endIndex}`;

    // Handle imports
    if (name === "import.stmt") {
      imports.push(node.text.trim());
      continue;
    }

    // Capture class context
    if (name === "class.name" || name === "struct.name" || name === "interface.name") {
      currentClassName = node.text.trim();
    }

    // Unified node representation
    let nodeType = null;
    let symbolPath = "";

    const declaredName = node.childForFieldName ? node.childForFieldName("name")?.text : null;

    if (name === "class.def" || name === "struct.def") {
      nodeType = "class";
      const clsName = declaredName || currentClassName || `Class_L${node.startPosition.row + 1}`;
      currentClassName = clsName;
      symbolPath = clsName;
    } else if (name === "interface.def") {
      nodeType = "interface";
      const ifaceName = declaredName || currentClassName || `Interface_L${node.startPosition.row + 1}`;
      symbolPath = ifaceName;
    } else if (name === "method.def") {
      nodeType = "method";
      const methodName = declaredName || (node.childForFieldName ? node.childForFieldName("name")?.text : "method");
      symbolPath = currentClassName ? `${currentClassName}.${methodName || "method"}` : (methodName || "method");
    } else if (name === "func.def" || name === "arrow.def") {
      nodeType = "function";
      const funcName = declaredName || "anonymousFunction";
      symbolPath = currentClassName ? `${currentClassName}.${funcName}` : (funcName || `func_L${node.startPosition.row + 1}`);
    } else if (name === "try.block") {
      nodeType = "error_handler";
      symbolPath = currentClassName ? `${currentClassName}.try_catch_L${node.startPosition.row + 1}` : `try_catch_L${node.startPosition.row + 1}`;
    }

    if (nodeType && !processedRanges.has(rangeKey)) {
      processedRanges.add(rangeKey);
      const nodeText = content.slice(node.startIndex, node.endIndex);
      const signatures = analyzeCodeSignatures(nodeText, language);

      nodes.push({
        symbolPath,
        type: nodeType,
        language,
        filePath,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        signatures,
        code: nodeText
      });
    }
  }

  return {
    filePath,
    language,
    nodes,
    imports,
    totalLines: (content.match(/\n/g) || []).length + 1
  };
}
