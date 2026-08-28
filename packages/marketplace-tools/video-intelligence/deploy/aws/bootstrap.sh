#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-eu-central-1}"
github_org="${1:-Larkup-AI}"
github_repo="${2:-larkup}"
github_environment="${3:-production}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
account_id="$(aws sts get-caller-identity --query Account --output text)"
provider_arn="arn:aws:iam::${account_id}:oidc-provider/token.actions.githubusercontent.com"
existing_provider=""
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "${provider_arn}" >/dev/null 2>&1; then
  existing_provider="${provider_arn}"
fi

aws cloudformation deploy \
  --region "${region}" \
  --stack-name larkup-video-bootstrap \
  --template-file "${script_dir}/bootstrap.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    GitHubOrg="${github_org}" \
    GitHubRepo="${github_repo}" \
    GitHubEnvironment="${github_environment}" \
    ExistingOidcProviderArn="${existing_provider}"

aws cloudformation describe-stacks \
  --region "${region}" \
  --stack-name larkup-video-bootstrap \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table
