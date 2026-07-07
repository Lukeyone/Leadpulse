# CI Verification

This file records the initial verification of the sanitized LeadPulse release.

The repository workflow runs:

```bash
npm test
```

The command validates JavaScript syntax and scans the working tree for obvious credentials, forbidden legacy folders, and accidentally committed local environment files.
