# OrbitFS Azure Core

Standalone Azure build of OrbitFS Core.

The `panel` and `engine` directories are copied into this repository from the V1 core repositories and adapted here for Azure App Service. The V1 repositories are not checked out during deployment and are not modified by this project.

## Azure

Both applications use the SvelteKit Node adapter and start with `npm start`. The GitHub Actions workflow builds the local copies and deploys them to two Azure Web Apps: Panel/Base and Engine.

Configure the application secrets/environment values from each component's `.env.example` in Azure App Service Configuration.