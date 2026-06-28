import Table from "cli-table3";

export function createTable(head: string[]) {
  return new Table({
    head,
    style: { head: ["cyan"], border: ["grey"] },
  });
}
