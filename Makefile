PYTHON ?= .venv/bin/python
SITE_DIR ?= frontend/dist
# The CDK CLI pinned in package-lock.json (`make install` runs npm ci).
CDK ?= npx --no-install cdk

.PHONY: install lint test audit frontend privacy synth diff clean

install:            ## Create the virtualenv and install everything
	python3 -m venv .venv
	$(PYTHON) -m pip install --upgrade pip
	$(PYTHON) -m pip install -r requirements-dev.txt
	$(PYTHON) -m pip check
	npm ci --ignore-scripts --no-audit --no-fund  # the CDK CLI and pyright
	npm ci --prefix frontend --ignore-scripts --no-audit --no-fund  # the PWA and its tools

lint:               ## Python: ruff (with Bandit security rules) and pyright types
	$(PYTHON) -m ruff check .
	$(PYTHON) -m ruff format --check .
	npx --no-install pyright

test:
	$(PYTHON) -m pytest -n auto

audit:              ## Check dependencies for known vulnerabilities
	$(PYTHON) -m pip_audit -r requirements-dev.txt

frontend:           ## PWA: ESLint, TypeScript types, Vitest, Vite build and the size limit
	cd frontend && npm run -s lint && npm run -s typecheck && npm run -s test && npm run -s build
	scripts/check_size.sh frontend/dist

privacy:            ## Fail on TennisID-shaped strings or data exports in tracked files (public repo)
	scripts/check_personal_data.sh

synth:              ## Synthesize CloudFormation and run cdk-nag security checks
	. .venv/bin/activate && $(CDK) synth --quiet -c siteDir=$(SITE_DIR)

diff:
	. .venv/bin/activate && $(CDK) diff

clean:
	rm -rf build cdk.out .pytest_cache .ruff_cache .coverage
