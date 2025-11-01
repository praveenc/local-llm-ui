# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Currently supported versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Local LLM UI seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### Please Do Not

- **Do not** open a public GitHub issue for security vulnerabilities
- **Do not** disclose the vulnerability publicly until it has been addressed

### How to Report

**Email:** Please report security vulnerabilities by emailing the maintainers directly. Include:

1. **Description** of the vulnerability
2. **Steps to reproduce** the issue
3. **Potential impact** of the vulnerability
4. **Suggested fix** (if you have one)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your vulnerability report within 48 hours
- **Updates**: We will send you regular updates about our progress
- **Timeline**: We aim to address critical vulnerabilities within 7 days
- **Credit**: We will credit you in the security advisory (unless you prefer to remain anonymous)

## Security Best Practices

### For Users

1. **Keep Updated**: Always use the latest version of Local LLM UI
2. **Local Only**: This application is designed for local use only
3. **Network Security**: Do not expose Ollama or LM Studio ports to the internet
4. **Review Code**: Review the source code before running if you have concerns
5. **Dependencies**: Keep Node.js and npm updated

### For Developers

1. **Dependencies**: Regularly update dependencies to patch known vulnerabilities
2. **Code Review**: All code changes should be reviewed before merging
3. **Input Validation**: Validate and sanitize all user inputs
4. **Secrets**: Never commit API keys, tokens, or credentials
5. **HTTPS**: Use HTTPS for any external connections (currently none)

## Known Security Considerations

### Local-First Architecture

- **Privacy**: All data stays on your local machine
- **No Cloud**: No data is sent to external servers
- **Local AI**: Connects only to local AI providers (Ollama, LM Studio)

### Network Connections

- **Ollama**: Connects to `localhost:11434`
- **LM Studio**: Connects to `localhost:1234`
- **No External APIs**: No connections to external services

### Data Storage

- **Browser Storage**: Chat history stored in browser's local storage
- **No Server**: No backend server storing user data
- **Temporary**: Data can be cleared by clearing browser data

## Security Features

### Current

- ✅ Local-only operation
- ✅ No external API calls
- ✅ No user authentication required (local app)
- ✅ No data transmission to external servers
- ✅ Open source code for transparency

### Planned

- 🔄 Content Security Policy (CSP) headers
- 🔄 Subresource Integrity (SRI) for CDN resources
- 🔄 Regular security audits
- 🔄 Automated dependency vulnerability scanning

## Vulnerability Disclosure Policy

### Our Commitment

- We will respond to security reports within 48 hours
- We will work with you to understand and address the issue
- We will keep you informed of our progress
- We will credit you in the security advisory (if desired)

### Disclosure Timeline

1. **Day 0**: Vulnerability reported
2. **Day 1-2**: Acknowledgment sent
3. **Day 3-7**: Investigation and fix development
4. **Day 7-14**: Testing and verification
5. **Day 14+**: Public disclosure and release

### Public Disclosure

- We will coordinate disclosure timing with the reporter
- We will publish a security advisory on GitHub
- We will release a patched version
- We will update the CHANGELOG

## Security Updates

Security updates will be released as:

- **Patch versions** (1.0.x) for minor security fixes
- **Minor versions** (1.x.0) for moderate security issues
- **Major versions** (x.0.0) for critical security changes

## Dependencies

We regularly monitor and update dependencies for security vulnerabilities:

- **npm audit**: Run regularly to check for known vulnerabilities
- **Dependabot**: Automated dependency updates (if enabled)
- **Manual review**: Critical dependencies reviewed manually

## Scope

### In Scope

- Security vulnerabilities in the application code
- Dependency vulnerabilities
- Configuration issues leading to security problems
- XSS, CSRF, or injection vulnerabilities
- Authentication/authorization bypasses (if applicable)

### Out of Scope

- Issues in Ollama or LM Studio (report to their respective projects)
- Browser vulnerabilities
- Operating system vulnerabilities
- Social engineering attacks
- Physical access attacks

## Contact

For security concerns, please contact the project maintainers:

- **GitHub**: Open a security advisory (preferred)
- **Email**: [Contact information to be added]

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [React Security Best Practices](https://react.dev/learn/security)

## Acknowledgments

We thank the security researchers and contributors who help keep Local LLM UI secure.

---

**Last Updated**: January 31, 2025
