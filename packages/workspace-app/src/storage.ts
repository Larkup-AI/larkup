import * as idb from 'idb-keyval';
import { workspaceStorageScope } from './host';
const scoped = (key: IDBValidKey) =>
  workspaceStorageScope() ? `${workspaceStorageScope()}:${String(key)}` : key;
export const get = <T = any>(key: IDBValidKey) => idb.get<T>(scoped(key));
export const set = <T>(key: IDBValidKey, value: T) => idb.set(scoped(key), value);
export const del = (key: IDBValidKey) => idb.del(scoped(key));
export async function keys(): Promise<IDBValidKey[]> {
  const all = await idb.keys();
  const prefix = workspaceStorageScope();
  return prefix
    ? all
        .filter((key) => typeof key === 'string' && key.startsWith(prefix + ':'))
        .map((key) => String(key).slice(prefix.length + 1))
    : all;
}
