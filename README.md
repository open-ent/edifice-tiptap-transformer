# À propos d'edifice-tiptap-transformer
    
* Licence : [AGPL v3](http://www.gnu.org/licenses/agpl.txt) - Copyright Edifice
* Financeur(s) : Edifice
* Développeur(s) : Edifice
* Description : service permettant de transformer des contenus de l'ancien éditeur dans le nouveau format tiptap.

# Fork Open ENT

Branche `X.Y.Z-patched-dev`, tag `X.Y.Z-patched`, image `ghcr.io/open-ent/edifice-tiptap-transformer`
publiée par `.github/workflows/build-and-publish.yml`. Différences avec l'amont :

- **Extensions** : `@open-ent/tiptap-extensions` (GitHub Packages) à la place de `@edifice.io/tiptap-extensions`.
  Un bloc de l'éditeur absent de `EXTENSIONS` (ou de `ADDITIONAL_EXTENSIONS`, activé par
  `additionalExtensionIds`) est supprimé du `cleanHtml` que blog, actualités, wiki et messagerie enregistrent.
- **Supervision** (lue par le dashboard, `/admin/configuration/openent?tab=content-transformer`) :
  - `GET /health` : versions, blocs connus, compteurs et durées par opération, codes de réponse et
    dernières erreurs de `/transform`, agrégés sur tous les workers ;
  - `POST /diagnose` (`{ "html": "…" }`) : `cleanHtml`, et les éléments et attributs supprimés ou ajoutés.
- **Image** : jeton npm passé en secret de construction (`--secret id=node_auth_token,src=…`),
  dépendances de dev installées pour `tsc`, utilisateur `nonroot` (distroless n'a pas d'utilisateur `node`).

# Rich content transformer

- [Rich content transformer](#rich-content-transformer)
  - [In Docker](#in-docker)
  - [Without Docker](#without-docker)
    - [Installation](#installation)
    - [Customization](#customization)
    - [Build](#build)
    - [Local run](#local-run)
  - [Call samples](#call-samples)
  - [Load testing](#load-testing)
  - [Description](#description)
  - [Execution](#execution)
  - [Extension](#extension)



## In Docker


```shell
docker-compose up -d content-transformer --build
```

## Without Docker
### Installation

```shell
pnpm i
```

### Customization

Execute the following command :

```shell
cp .env.template .env
```

Then modify `.env` file to suit your needs (all variables are optional and can be removed) :

- **PORT** (default: 3000): port number on which the service is listening for transformation request
- **METRICS_PORT** (default: 3001): port number on which the service is listening to serve the metrics
- **NB_THREADS** (default: number of CPUs): number of concurrent services that will handle transformation requests. In development environments it is best to set this value to 1. In production, it should be set to the number of available CPUs (or removed from .env file, which will have the same effect)
- **MAX_BODY_SIZE** (default: 2mb): the maximum size of a request body. Beyond the specified limit, the request will be rejected.

### Build

```shell
pnpm run build
```

### Local run

```shell
pnpm run dev
```

## Call samples

To transform an HTML to JSON:

```shell
curl -L -X POST 'http://localhost:3000/transform' -H 'Content-Type: application/json' -d '{
    "requestedFormats": ["json"],
    "contentVersion": 0,
    "htmlContent": "<span>Le lorem ipsum est, en imprimerie, une suite de mots sans signification utilisée à titre provisoire pour calibrer une mise en page<br><h1>Hello world</h1><br><a href=\"https://www.website.com\">Website</a>"
}'
```

To transform an HTML to PLAIN TEXT:

```shell
curl -L -X POST 'http://localhost:3000/transform' -H 'Content-Type: application/json' -d '{
    "requestedFormats": ["plainText"],
    "contentVersion": 0,
    "htmlContent": "<span>Le lorem ipsum est, en imprimerie, une suite de mots sans signification utilisée à titre provisoire pour calibrer une mise en page<br><h1>Hello world</h1><br><a href=\"https://www.website.com\">Website</a>"
}'
```

To clean an HTML:

```shell
curl -L -X POST 'http://localhost:3000/transform' -H 'Content-Type: application/json' -d '{
    "requestedFormats": ["html"],
    "contentVersion": 0,
    "htmlContent": "<span>Le lorem ipsum est, en imprimerie, une suite de mots sans signification utilisée à titre provisoire pour calibrer une mise en page<br><h1>Hello world</h1><br><a href=\"https://www.website.com\">Website"
}'
```

To transform a JSON to HTML and PLAIN TEXT:

```shell
curl -L -X POST 'http://localhost:3000/transform' -H 'Content-Type: application/json' -d '{
    "requestedFormats": [
        "html",
        "plainText"
    ],
    "contentVersion": 0,
    "jsonContent": {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "attrs": {
                    "textAlign": "left"
                },
                "content": [
                    {
                        "type": "text",
                        "text": "Le lorem ipsum est, en imprimerie, une suite de mots sans signification utilisée à titre provisoire pour calibrer une mise en page"
                    }
                ]
            }
        ]
    }
}'
```

To access metrics:

```shell
curl -L -X GET 'http://localhost:3000/metrics'
```

Healthcheck :

```shell
curl -L -X GET 'http://localhost:3000/healthcheck'
```

## Load testing

## Description

Load testing are run by launching load-tester container. This container can be customized by changing its environment variables :
- `ROOT_URL`, the root URL of the content transformer to load test (shoul be kept to `http://content-transformer:3000` to test your local service)
- `DATA_ROOT_PATH`, should not be changed
- `DURATION`, the duration of the test
- `VUS`, the number of virtual users (see [official documentation](https://k6.io/docs/get-started/running-k6/) for more information)


## Execution

```shell
docker-compose up -d content-transformer --build # To start your container with the latest version of your local source
docker-compose run --rm load-tester run src/index.js # Starts the tests
```

## Extension

To add more files to the test set, add html files in `test/data/big` or `test/data/small` (depending on its size) and make sure to change the way `smallHtmls` and `bigHtmls` are loaded in [index.ts](./index.ts).