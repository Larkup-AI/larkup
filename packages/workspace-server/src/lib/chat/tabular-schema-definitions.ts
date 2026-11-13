type Dataset = { id: string; fileName: string; columns: Array<{ name: string }> };
type Document = { title: string; content: string };

/** Associate explicit resource schemas with exact upload filenames. */
export function tabularSchemaDefinitions(
  datasets: readonly Dataset[],
  documents: readonly Document[],
) {
  const definitions = new Map<string, Map<string, string>>();
  for (const document of documents.filter(
    (item) => /\.json$/iu.test(item.title) && item.content.length <= 1_000_000,
  )) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(document.content);
    } catch {
      continue;
    }
    const resources =
      parsed && typeof parsed === 'object'
        ? (parsed as { resources?: unknown }).resources
        : undefined;
    if (!Array.isArray(resources)) continue;
    for (const resource of resources.slice(0, 200)) {
      if (!resource || typeof resource !== 'object') continue;
      const paths = (Array.isArray(resource.path) ? resource.path : [resource.path]).filter(
        (value: unknown): value is string => typeof value === 'string',
      );
      const names = paths.map((path: string) =>
        path.split(/[?#]/)[0].split(/[\\/]/).at(-1)?.toLocaleLowerCase(),
      );
      if (!Array.isArray(resource.schema?.fields)) continue;
      for (const dataset of datasets.filter((item) =>
        names.includes(item.fileName.toLocaleLowerCase()),
      )) {
        const fields = definitions.get(dataset.id) ?? new Map<string, string>();
        for (const field of resource.schema.fields.slice(0, 250)) {
          if (
            typeof field?.name !== 'string' ||
            typeof field.description !== 'string' ||
            !dataset.columns.some((column) => column.name === field.name)
          )
            continue;
          const description = `${document.title}: ${field.description.slice(0, 400)}`;
          const previous = fields.get(field.name);
          fields.set(
            field.name,
            previous ? `${previous}; ${description}`.slice(0, 900) : description,
          );
        }
        definitions.set(dataset.id, fields);
      }
    }
  }
  return definitions;
}
