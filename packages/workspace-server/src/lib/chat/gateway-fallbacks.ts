/** Keep provider failover within the selected model; never silently substitute another model. */
export function gatewayProviderOptions(_provider: string, _primaryModelId: string) {
  return undefined;
}
