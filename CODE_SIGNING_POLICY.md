# Code Signing Policy — KRB View

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## Team Roles

- **Committers and Reviewers:** [guimcasagrande-star](https://github.com/guimcasagrande-star)
- **Approvers:** [guimcasagrande-star](https://github.com/guimcasagrande-star)

## Signing Process

- All signed release binaries (`visualizador-dicom.exe`, NSIS `-setup.exe` installer, and `.msi` installer) are built exclusively on GitHub-hosted Windows runners (`windows-latest`) via [`.github/workflows/release.yml`](.github/workflows/release.yml) from tagged commits (`v*`) on the `main` branch.
- Unit tests (`npm test`) run automatically before building and submitting artifacts for code signing.
- Signed releases are published directly to [GitHub Releases](https://github.com/guimcasagrande-star/krb-view/releases).

## Privacy Policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

In particular:
- KRB View processes all DICOM imaging studies, segmentations, exports, and measurements **100% locally** on the user's machine.
- No telemetry, analytics, patient metadata, or imaging data is ever sent to any external server.
- Network connections are made **only** when explicitly initiated by the user:
  1. Connecting to a user-configured local/hospital DICOM PACS server (C-ECHO, C-FIND, C-GET, or C-MOVE).
  2. Checking for or downloading application updates from GitHub Releases (`guimcasagrande-star/krb-view`).

## Medical Disclaimer

KRB View is an open-source personal/educational DICOM viewer. It is **not a medical device** and is **not validated for clinical diagnosis**.
