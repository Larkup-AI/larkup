import type { PlopTypes } from "@turbo/gen";

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  // Register the 'eq' helper for Handlebars
  plop.setHelper("eq", (a, b) => a === b);

  plop.setGenerator("package", {
    description: "Generate a new package with TypeScript, Vitest, and ESLint",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "What is the name of the package?",
        validate: (input: string) => {
          if (!input) return "Package name is required";
          if (!/^[a-z0-9-]+$/.test(input)) {
            return "Package name must be lowercase and contain only letters, numbers, and hyphens";
          }
          return true;
        },
      },
      {
        type: "input",
        name: "description",
        message: "Package description:",
        default: "",
      },
      {
        type: "list",
        name: "packageType",
        message: "Package type:",
        choices: ["packages", "apps"],
        default: "packages",
      },
      {
        type: "confirm",
        name: "installDeps",
        message: "Install dependencies after creation?",
        default: true,
      },
    ],
    actions: (answers) => {
      const actions: PlopTypes.ActionType[] = [
        {
          type: "add",
          path: "{{ turbo.paths.root }}/{{kebabCase packageType}}/{{kebabCase name}}/package.json",
          templateFile: "templates/package.json.hbs",
        },
        {
          type: "add",
          path: "{{ turbo.paths.root }}/{{kebabCase packageType}}/{{kebabCase name}}/tsconfig.json",
          templateFile: "templates/tsconfig.json.hbs",
        },
        {
          type: "add",
          path: "{{ turbo.paths.root }}/{{kebabCase packageType}}/{{kebabCase name}}/vitest.config.ts",
          templateFile: "templates/vitest.config.ts.hbs",
        },
        {
          type: "add",
          path: "{{ turbo.paths.root }}/{{kebabCase packageType}}/{{kebabCase name}}/.eslintrc.js",
          templateFile: "templates/.eslintrc.js.hbs",
        },
        {
          type: "add",
          path: "{{ turbo.paths.root }}/{{kebabCase packageType}}/{{kebabCase name}}/src/index.ts",
          templateFile: "templates/index.ts.hbs",
        },
        {
          type: "add",
          path: "{{ turbo.paths.root }}/{{kebabCase packageType}}/{{kebabCase name}}/README.md",
          templateFile: "templates/README.md.hbs",
        },
        {
          type: "add",
          path: "{{ turbo.paths.root }}/{{kebabCase packageType}}/{{kebabCase name}}/.gitignore",
          templateFile: "templates/.gitignore.hbs",
        },
        {
          type: "add",
          path: "{{ turbo.paths.root }}/{{kebabCase packageType}}/{{kebabCase name}}/tsup.config.ts",
          templateFile: "templates/tsup.config.ts.hbs",
        },
      ];

      // Add success message
      actions.push(function (answers: any) {
        const dir = answers?.packageType === "apps" ? "apps" : "packages";
        const steps = answers?.installDeps
          ? `\nNext steps:\n  cd ${dir}/${answers?.name}\n  pnpm dev`
          : `\nNext steps:\n  pnpm install\n  cd ${dir}/${answers?.name}\n  pnpm dev`;

        return `\n✅ Package @larkup-rag/${answers?.name} created successfully!${steps}`;
      });

      return actions;
    },
  });
}
