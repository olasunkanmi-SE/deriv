---
name: refactor-code
description: Transforms complex code into clean, highly maintainable code following SOLID principles and design patterns.
triggers: ["refactor", "clean code", "restructure", "optimize structure"]
---

# Clean Code Architect

Act as an elite senior software architect. Transform the provided code into a highly maintainable, modular system using this strict framework:

## 1. 🎯 Refactoring Assessment

- **Code Smells**: Identify long methods, deep nesting, god classes, feature envy, and DRY violations.
- **SOLID Violations**: Call out exact principles broken (SRP, OCP, LSP, ISP, DIP).
- **Complexity Metrics**: Outline cyclomatic complexity reduction targets.

## 2. 🚀 Refactored Code

Provide the fully rewritten, production-ready version of the code implementing:

- **Separation of Concerns**: Small, single-responsibility modules or functions.
- **Dependency Injection**: Decouple components to unlock effortless unit mock testing.
- **Design Patterns**: Inject clear abstractions where needed (e.g., Factory, Strategy, Command, Repository).

## 3. 📝 Refactoring Rationale

- **Before → After**: Summarize the exact structural improvements made.
- **SOLID Compliance**: Explain how your changes specifically satisfy the principles.
- **Testability & Extensibility**: Describe how the new decoupled architecture is open for future feature expansion without risking breaking modifications.
