# SAM's CustomMakeBuilder copies CodeUri into an ephemeral temp directory
# and runs make from there -- no relative path from this Makefile can reach
# back into the repo to find gpu_providers/ (a sibling of aws/, outside this
# function's own CodeUri, needed importable as `gpu_providers.*` for the
# provider registry; see ../../gpu_providers/README.md). GPU_PROVIDERS_DIR
# must be exported as an absolute path by whoever invokes `sam build`:
#
#   cd packages/marketplace-tools/video-intelligence/deploy/aws
#   GPU_PROVIDERS_DIR="$(cd ../gpu_providers && pwd)" sam build
#
ifndef GPU_PROVIDERS_DIR
$(error GPU_PROVIDERS_DIR is not set -- export it as an absolute path before running sam build; see this Makefile's header comment)
endif

PYTHON ?= python3.12

build-ControlPlane:
	mkdir -p "$(ARTIFACTS_DIR)"
	cp *.py "$(ARTIFACTS_DIR)/"
	cp -r "$(GPU_PROVIDERS_DIR)" "$(ARTIFACTS_DIR)/gpu_providers"
	rm -rf "$(ARTIFACTS_DIR)/gpu_providers/tests" "$(ARTIFACTS_DIR)/gpu_providers/requirements.txt"
	find "$(ARTIFACTS_DIR)/gpu_providers" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
	$(PYTHON) -m pip install --no-cache-dir \
		--platform manylinux2014_aarch64 \
		--implementation cp \
		--python-version 3.12 \
		--abi cp312 \
		--only-binary=:all: \
		-r "$(GPU_PROVIDERS_DIR)/requirements.txt" \
		-t "$(ARTIFACTS_DIR)"
