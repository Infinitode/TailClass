# Contributing to TailClass

Thank you for considering contributing to **TailClass**! Contributions, whether they are bug fixes, new UI naming archetypes, framework parser improvements, or documentation updates, are always welcome. Before contributing, please read the following guidelines to ensure smooth collaboration.

## Getting Started

1. **Fork the Repository**  
   Create a fork of this repository to your GitHub account and clone it locally:

   ```bash
   git clone https://github.com/<your-username>/TailClass.git
   cd TailClass
   ```

2. **Set Up the Environment**  
   Install Node.js 18+ (Node 20 or 22 recommended). **TailClass has zero runtime or dev dependencies**, so there is nothing to install before running checks.

3. **Run Tests & Linter**  
   Before and after making changes, run the static checks, test suite, and live demo:

   ```bash
   npm run lint    # syntax, JSON schema, and hygiene checks
   npm test        # Node built-in test runner covering scanner, namer, dictionaries, rewriter & CLI
   npm run demo    # end-to-end sample site run
   ```

   Pull requests run lint and the Node 22 test job. The full Node 18 / 20 / 22 matrix runs on `main` / `master`. New behaviour should come with a test; bug fixes should come with a regression test that fails before the fix.

> [!TIP]
> Because TailClass relies exclusively on Node's standard library (`node:test`, `node:fs`, `node:crypto`), the entire test suite finishes in well under a second.

## How to Contribute

1. **Report Issues**  
   Use the [GitHub Issues page](https://github.com/Infinitode/TailClass/issues) to report bugs or suggest features. Please include:
   - A clear description of the issue or suggestion.
   - Minimal HTML / JSX / Vue snippet reproducing the behaviour (for bugs).

2. **Make Changes**  
   - Use clear and descriptive commit messages.
   - Write unit tests in `test/` covering new heuristics, config flags, or edge cases.
   - Keep the package **dependency-free** unless discussed with maintainers beforehand.
   - Ensure code remains readable, modular, and well-commented.

3. **Submit a Pull Request**  
   - Push your changes to a feature branch in your fork.
   - Submit a pull request with a clear explanation of what changed and why.
   - Ensure your PR passes all automated CI checks.
   - Add an entry to `CHANGELOG.md` for user-visible changes.

## Community Guidelines

To maintain a positive and collaborative community, we ask that all contributors adhere to the following principles:

1. **Be Respectful**  
   Treat others with respect, regardless of their background or expertise.

2. **Provide Constructive Feedback**  
   Offer helpful and actionable suggestions during code reviews.

3. **Follow Licensing Requirements**  
   Ensure that any derivative works comply with the [license](https://github.com/Infinitode/TailClass/blob/main/LICENSE) (`MIT License (Modified)`).

By contributing, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md) and this project's [license](LICENSE). Thank you for helping make **TailClass** better!
