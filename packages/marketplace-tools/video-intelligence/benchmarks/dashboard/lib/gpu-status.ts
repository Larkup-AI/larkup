import type { JsonRow } from './contract.js';

export function gpuServicesReady(services: JsonRow[]): boolean {
  return ['benchmark controller', 'canonical video runtime'].every((name) =>
    services.some((service) => service.name === name && service.state === 'running'),
  );
}
