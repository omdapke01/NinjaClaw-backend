// Style Profile Extractor
const STYLE_PROFILE_SCHEMA = {
  type: "object",
  properties: {
    oopAndPatterns: {
      type: "object",
      properties: {
        primaryParadigm: { type: "string" },
        dependencyInjection: { type: "string" },
        architecturalStyle: { type: "string" },
        keyPatterns: { type: "array", items: { type: "string" } }
      },
      required: ["primaryParadigm", "dependencyInjection", "architecturalStyle", "keyPatterns"]
    },
    errorHandling: {
      type: "object",
      properties: {
        strategy: { type: "string" },
        customErrorClasses: { type: "array", items: { type: "string" } },
        errorResponseFormat: { type: "string" },
        loggingConventions: { type: "string" }
      },
      required: ["strategy", "customErrorClasses", "errorResponseFormat", "loggingConventions"]
    },
    edgeCasesAndGuards: {
      type: "object",
      properties: {
        guardClauseStyle: { type: "string" },
        nullSafety: { type: "string" },
        validationApproach: { type: "string" },
        commonGuards: { type: "array", items: { type: "string" } }
      },
      required: ["guardClauseStyle", "nullSafety", "validationApproach", "commonGuards"]
    },
    namingAndTypes: {
      type: "object",
      properties: {
        variableCasing: { type: "string" },
        functionCasing: { type: "string" },
        classCasing: { type: "string" },
        fileNaming: { type: "string" },
        typeStrictness: { type: "string" }
      },
      required: ["variableCasing", "functionCasing", "classCasing", "fileNaming", "typeStrictness"]
    },
    recommendedExemplarSymbols: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          symbolPath: { type: "string" },
          filePath: { type: "string" },
          rationale: { type: "string" }
        },
        required: ["category", "symbolPath", "filePath", "rationale"]
      }
    }
  },
  required: [
    "oopAndPatterns",
    "errorHandling",
    "edgeCasesAndGuards",
    "namingAndTypes",
    "recommendedExemplarSymbols"
  ]
};

function generateDeterministicFallback(configFacts, sampledFiles) {
  const allNodes = sampledFiles.flatMap((f) => f.rawNodes || []);
  const hasClasses = allNodes.some((n) => n.type === "class");
  const hasDI = allNodes.some((n) => n.signatures.hasDependencyInjection);
  const hasEarlyReturn = allNodes.some((n) => n.signatures.hasEarlyReturn);
  const usesCustomError = allNodes.some((n) => n.signatures.errorPattern === "throws_custom_error");
  const validation = configFacts.installedValidation[0] || (allNodes.find((n) => n.signatures.validationLibrary !== "none")?.signatures.validationLibrary) || "manual_guard";

  return {
    oopAndPatterns: {
      primaryParadigm: hasClasses ? "class_based" : "functional_modular",
      dependencyInjection: hasDI ? "constructor_injection" : "parameter_passing",
      architecturalStyle: configFacts.detectedFrameworks.length > 0 ? `${configFacts.detectedFrameworks.join("/")}_service_layered` : "modular_layered",
      keyPatterns: ["early_returns", hasClasses ? "encapsulation" : "pure_functions"]
    },
    errorHandling: {
      strategy: usesCustomError ? "throws_custom_error_subclasses" : "throws_standard_error_with_status",
      customErrorClasses: usesCustomError ? ["AppError", "HttpError"] : [],
      errorResponseFormat: "{ message: string, status?: number }",
      loggingConventions: configFacts.installedLogging[0] ? `${configFacts.installedLogging[0]}_logger` : "console_error"
    },
    edgeCasesAndGuards: {
      guardClauseStyle: hasEarlyReturn ? "early_return_with_fast_fail" : "nested_if_checks",
      nullSafety: "optional_chaining_and_falsy_check",
      validationApproach: validation,
      commonGuards: ["if (!input) return ...", "if (error) throw ..."]
    },
    namingAndTypes: {
      variableCasing: "camelCase",
      functionCasing: "camelCase",
      classCasing: "PascalCase",
      fileNaming: "camelCase_or_kebabCase",
      typeStrictness: configFacts.strictTypeChecking ? "strict_typescript" : "standard"
    },
    recommendedExemplarSymbols: []
  };
}

export async function extractStyleProfile({ configFacts, sampledFiles, allNodes, apiKey, model = "gemini-2.5-flash" }) {
  // If no API key is set, use deterministic analysis
  if (!apiKey) {
    const fallback = generateDeterministicFallback(configFacts, sampledFiles);
    const exemplars = findGoldenExemplars(fallback.recommendedExemplarSymbols, allNodes);
    return {
      conventions: {
        oopAndPatterns: fallback.oopAndPatterns,
        errorHandling: fallback.errorHandling,
        edgeCasesAndGuards: fallback.edgeCasesAndGuards,
        namingAndTypes: fallback.namingAndTypes
      },
      exemplars
    };
  }

  // Build compact AST summaries payload
  const astSummariesForPrompt = sampledFiles.map((f) => ({
    filePath: f.filePath,
    language: f.language,
    totalLines: f.totalLines,
    nodes: f.nodesSummary
  }));

  const prompt = [
    "You are a Principal Software Architect analyzing a software repository.",
    "Your goal is to extract the exact 'Codebase Style DNA' so another AI assistant can write code matching this exact project's conventions.",
    "",
    "=== DETERMINISTIC CONFIG FACTS (Detected from config files) ===",
    JSON.stringify(configFacts, null, 2),
    "",
    "=== STRATIFIED AST SUMMARIES (Representative code architecture) ===",
    JSON.stringify(astSummariesForPrompt, null, 2),
    "",
    "INSTRUCTIONS:",
    "1. Analyze how OOP or functional patterns are used (classes, inheritance, dependency injection, layers).",
    "2. Identify error handling signatures: do they throw custom errors (e.g. AppError, NotFoundError), return typed result tuples, or use try/catch blocks?",
    "3. Identify edge-case guards: do they use early returns (if (!param) return), schema validation (Zod, Pydantic), or null checks?",
    "4. Identify naming and typing conventions.",
    "5. Recommend 2 to 3 exemplary symbolPaths from the provided AST summaries that represent the cleanest patterns in this repository (e.g., one exemplary service method, one error handler, one class with DI).",
    "",
    "Return your response strictly adhering to the JSON schema."
  ].join("\n");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            topP: 0.8,
            maxOutputTokens: 3000,
            responseMimeType: "application/json",
            responseSchema: STYLE_PROFILE_SCHEMA
          }
        })
      }
    );

    const payload = await response.json();
    if (!response.ok) {
      console.warn("[styleExtractor] Gemini structured call failed, using deterministic fallback:", payload?.error?.message);
      const fallback = generateDeterministicFallback(configFacts, sampledFiles);
      const exemplars = findGoldenExemplars([], allNodes);
      return {
        conventions: {
          oopAndPatterns: fallback.oopAndPatterns,
          errorHandling: fallback.errorHandling,
          edgeCasesAndGuards: fallback.edgeCasesAndGuards,
          namingAndTypes: fallback.namingAndTypes
        },
        exemplars
      };
    }

    const rawJsonText = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(rawJsonText);
    const exemplars = findGoldenExemplars(parsed.recommendedExemplarSymbols || [], allNodes);

    return {
      conventions: {
        oopAndPatterns: parsed.oopAndPatterns,
        errorHandling: parsed.errorHandling,
        edgeCasesAndGuards: parsed.edgeCasesAndGuards,
        namingAndTypes: parsed.namingAndTypes
      },
      exemplars
    };
  } catch (err) {
    console.error("[styleExtractor] Error during style extraction:", err.message);
    const fallback = generateDeterministicFallback(configFacts, sampledFiles);
    const exemplars = findGoldenExemplars([], allNodes);
    return {
      conventions: {
        oopAndPatterns: fallback.oopAndPatterns,
        errorHandling: fallback.errorHandling,
        edgeCasesAndGuards: fallback.edgeCasesAndGuards,
        namingAndTypes: fallback.namingAndTypes
      },
      exemplars
    };
  }
}

function findGoldenExemplars(recommendedSymbols = [], allNodes = []) {
  const exemplars = [];
  const usedCodes = new Set();

  // 1. First, match symbols explicitly recommended by LLM
  for (const rec of recommendedSymbols) {
    const matchingNode = allNodes.find(
      (n) => n.symbolPath === rec.symbolPath || (n.filePath === rec.filePath && n.symbolPath.includes(rec.symbolPath))
    );
    if (matchingNode && matchingNode.code && !usedCodes.has(matchingNode.code)) {
      usedCodes.add(matchingNode.code);
      exemplars.push({
        category: rec.category || "service_method",
        symbolPath: matchingNode.symbolPath,
        filePath: matchingNode.filePath,
        code: matchingNode.code
      });
    }
  }

  // 2. If fewer than 3 exemplars found, pick top exemplar candidates deterministically from allNodes
  if (exemplars.length < 3) {
    // Look for a method with early return + custom error
    const serviceExemplar = allNodes.find(
      (n) => (n.type === "method" || n.type === "function") &&
             n.signatures.hasEarlyReturn &&
             (n.signatures.errorPattern === "throws_custom_error" || n.signatures.errorPattern === "try_catch_wrapped") &&
             !usedCodes.has(n.code)
    );
    if (serviceExemplar) {
      usedCodes.add(serviceExemplar.code);
      exemplars.push({
        category: "service_method",
        symbolPath: serviceExemplar.symbolPath,
        filePath: serviceExemplar.filePath,
        code: serviceExemplar.code
      });
    }
  }

  if (exemplars.length < 3) {
    // Look for a class with dependency injection or clean methods
    const classExemplar = allNodes.find(
      (n) => n.type === "class" && !usedCodes.has(n.code)
    );
    if (classExemplar) {
      usedCodes.add(classExemplar.code);
      exemplars.push({
        category: "class_di",
        symbolPath: classExemplar.symbolPath,
        filePath: classExemplar.filePath,
        code: classExemplar.code
      });
    }
  }

  if (exemplars.length < 3) {
    // Look for an error handler or function with validation
    const guardExemplar = allNodes.find(
      (n) => (n.type === "method" || n.type === "function" || n.type === "error_handler") &&
             n.signatures.validationLibrary !== "none" &&
             !usedCodes.has(n.code)
    );
    if (guardExemplar) {
      usedCodes.add(guardExemplar.code);
      exemplars.push({
        category: "error_handler",
        symbolPath: guardExemplar.symbolPath,
        filePath: guardExemplar.filePath,
        code: guardExemplar.code
      });
    }
  }

  return exemplars.slice(0, 3);
}
