.PHONY: dev build lint lint-fix format test test-run test-ui check fix clean help

# Configuration
TAIL_LINES ?= 10
VERBOSE ?= 0

# Helper to run commands with controlled output
# Usage: $(call run,command,success_message)
define run
	@if [ "$(VERBOSE)" = "1" ]; then \
		$(1); \
	else \
		OUTPUT=$$($(1) 2>&1); \
		EXIT_CODE=$$?; \
		if [ $$EXIT_CODE -ne 0 ]; then \
			echo "$$OUTPUT" | tail -n 20; \
			exit $$EXIT_CODE; \
		else \
			echo "$$OUTPUT" | tail -n $(TAIL_LINES); \
			[ -n "$(2)" ] && echo "$(2)"; \
		fi; \
	fi
endef

# Development (interactive - no suppression)
dev:
	npm run dev

# Build
build:
	$(call run,npm run build,✓ Build complete)

# Linting
lint:
	$(call run,npm run lint,✓ Lint passed)

lint-fix:
	$(call run,npm run lint:fix,✓ Lint fixes applied)

# Formatting - with proper summary
format:
	@OUTPUT=$$(npm run format 2>&1) || { echo "$$OUTPUT" | tail -n 20; exit 1; }; \
	echo "$$OUTPUT" | grep -E '\.(js|ts|jsx|tsx|json|css|md)' | tail -n $(TAIL_LINES); \
	echo "✓ Format complete"

# Testing
test-run:
	$(call run,npm run test:run)

test:
	npm run test

test-ui:
	npm run test:ui

# Combined commands with proper error handling
check:
	@echo "→ Linting..."; \
	npm run lint 2>&1 | tail -n 5 || exit 1; \
	echo "→ Testing..."; \
	npm run test:run 2>&1 | tail -n 5 || exit 1; \
	echo "✓ All checks passed"

fix:
	@echo "→ Formatting..."; \
	npm run format 2>&1 | tail -n 3 || exit 1; \
	echo "→ Fixing lint issues..."; \
	npm run lint:fix 2>&1 | tail -n 3 || exit 1; \
	echo "✓ All fixes applied"

# Clean
clean:
	@rm -rf dist node_modules/.cache .eslintcache
	@echo "✓ Cleaned"

# Help (auto-generated from comments would be better, but keeping simple)
help:
	@echo "Usage: make [target] [VERBOSE=1] [TAIL_LINES=N]"
	@echo ""
	@echo "Targets:"
	@echo "  dev       Start development server (interactive)"
	@echo "  build     Build for production"
	@echo "  lint      Run ESLint"
	@echo "  lint-fix  Run ESLint with auto-fix"
	@echo "  format    Run Prettier"
	@echo "  test      Run tests (watch mode)"
	@echo "  test-run  Run tests once"
	@echo "  test-ui   Run tests with UI"
	@echo "  check     Run lint + tests"
	@echo "  fix       Run format + lint-fix"
	@echo "  clean     Remove build artifacts"
	@echo ""
	@echo "Options:"
	@echo "  VERBOSE=1      Show full output"
	@echo "  TAIL_LINES=N   Lines to show (default: 10)"
