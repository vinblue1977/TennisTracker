PYTHON ?= .venv/bin/python
# The CDK CLI pinned in package-lock.json (`make install` runs npm ci).
CDK ?= npx --no-install cdk

.PHONY: install lint test audit synth diff clean

install:            ## Create the virtualenv and install everything
	python3 -m venv .venv
	$(PYTHON) -m pip install --upgrade pip
	$(PYTHON) -m pip install -r requirements-dev.txt
	$(PYTHON) -m pip check
	npm ci --ignore-scripts --no-audit --no-fund  # the CDK CLI and pyright

lint:               ## Python: ruff (with Bandit security rules) and pyright types
	$(PYTHON) -m ruff check .
	$(PYTHON) -m ruff format --check .
	npx --no-install pyright

test:
	$(PYTHON) -m pytest

audit:              ## Check dependencies for known vulnerabilities
	$(PYTHON) -m pip_audit -r requirements-dev.txt

synth:              ## Synthesize CloudFormation and run cdk-nag security checks
	. .venv/bin/activate && $(CDK) synth --quiet

diff:
	. .venv/bin/activate && $(CDK) diff

clean:
	rm -rf build cdk.out .pytest_cache .ruff_cache .coverage
