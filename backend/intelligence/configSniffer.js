export function sniffConfigFiles(files = []) {
  const facts = {
    detectedConfigs: [],
    packageManager: "npm",
    moduleSystem: "unknown",
    strictTypeChecking: false,
    indentation: { type: "space", width: 2 },
    usesSemicolons: true,
    installedValidation: [],
    installedLogging: [],
    testFramework: "none",
    detectedFrameworks: []
  };

  const fileMap = new Map();
  for (const f of files) {
    const filename = f.path.split("/").pop();
    fileMap.set(filename, f.content || "");
  }

  // 1. package.json
  if (fileMap.has("package.json")) {
    facts.detectedConfigs.push("package.json");
    try {
      const pkg = JSON.parse(fileMap.get("package.json"));
      facts.moduleSystem = pkg.type === "module" ? "esm" : "commonjs";

      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {})
      };

      if (allDeps.zod) facts.installedValidation.push("zod");
      if (allDeps.joi) facts.installedValidation.push("joi");
      if (allDeps.yup) facts.installedValidation.push("yup");

      if (allDeps.winston) facts.installedLogging.push("winston");
      if (allDeps.pino) facts.installedLogging.push("pino");

      if (allDeps.jest) facts.testFramework = "jest";
      if (allDeps.vitest) facts.testFramework = "vitest";
      if (allDeps.mocha) facts.testFramework = "mocha";

      if (allDeps.express) facts.detectedFrameworks.push("express");
      if (allDeps.fastify) facts.detectedFrameworks.push("fastify");
      if (allDeps.react) facts.detectedFrameworks.push("react");
      if (allDeps["@nestjs/core"]) facts.detectedFrameworks.push("nestjs");
    } catch {
      // ignore json parse error
    }
  }

  // 2. tsconfig.json
  if (fileMap.has("tsconfig.json")) {
    facts.detectedConfigs.push("tsconfig.json");
    try {
      // Strip comments
      const raw = fileMap.get("tsconfig.json").replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, "");
      const tsconfig = JSON.parse(raw);
      const compilerOptions = tsconfig.compilerOptions || {};
      facts.strictTypeChecking = Boolean(compilerOptions.strict || compilerOptions.noImplicitAny);
    } catch {
      // ignore json parse error
    }
  }

  // 3. .prettierrc / prettier.config
  const prettierFile = files.find((f) => f.path.includes(".prettierrc") || f.path.includes("prettier.config"));
  if (prettierFile) {
    facts.detectedConfigs.push(prettierFile.path);
    try {
      const prettier = JSON.parse(prettierFile.content);
      if (typeof prettier.semi === "boolean") facts.usesSemicolons = prettier.semi;
      if (typeof prettier.tabWidth === "number") facts.indentation.width = prettier.tabWidth;
      if (prettier.useTabs) facts.indentation.type = "tab";
    } catch {
      // ignore
    }
  }

  // 4. pyproject.toml / requirements.txt
  if (fileMap.has("pyproject.toml") || fileMap.has("requirements.txt")) {
    const pyText = (fileMap.get("pyproject.toml") || "") + "\n" + (fileMap.get("requirements.txt") || "");
    facts.detectedConfigs.push(fileMap.has("pyproject.toml") ? "pyproject.toml" : "requirements.txt");
    if (/pydantic/.test(pyText)) facts.installedValidation.push("pydantic");
    if (/pytest/.test(pyText)) facts.testFramework = "pytest";
    if (/fastapi/.test(pyText)) facts.detectedFrameworks.push("fastapi");
    if (/django/.test(pyText)) facts.detectedFrameworks.push("django");
    if (/flask/.test(pyText)) facts.detectedFrameworks.push("flask");
  }

  // 5. pom.xml (Java)
  if (fileMap.has("pom.xml")) {
    const pom = fileMap.get("pom.xml");
    facts.detectedConfigs.push("pom.xml");
    if (/spring-boot/.test(pom)) facts.detectedFrameworks.push("spring-boot");
    if (/lombok/.test(pom)) facts.detectedFrameworks.push("lombok");
    if (/junit/.test(pom)) facts.testFramework = "junit";
    if (/log4j|logback/.test(pom)) facts.installedLogging.push("log4j");
  }

  return facts;
}
