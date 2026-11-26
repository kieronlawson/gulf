# Gulf Almanac

A fishing almanac for the Hauraki Gulf, built as one static web page.

For a chosen spot and day the page shows tides, sun, moon, solunar periods and weather. A map shows wind, current and a chop estimate for any time of the day.

## Build and test

Use the Node version named in `.nvmrc`.

```
npm install
npm run build     # writes dist/index.html
npm test
```

`dist/index.html` is the whole product. Any static host can serve it.

A push to `main` publishes the page to GitHub Pages. `.github/workflows/pages.yml` runs the tests first, and a failing test stops the publish. A pull request runs the tests and the build, but does not publish.

## What needs a connection

- Tides, sun, moon and solunar periods are computed in the page. They work offline.
- Weather, wind, current and chop come from Open-Meteo. The browser fetches them. The page keeps the last loaded forecast on the device.

## Accuracy

Auckland tides were checked against 146 high and low waters in the LINZ table for 2028. The median time difference is 2.3 minutes, nine in ten are within 6.1 minutes, and the largest is 9 minutes. Heights agree within 0.10 m.

The other spots apply LINZ secondary-port differences to the Auckland prediction. They have not been checked against LINZ daily tables.

The current model has cells of about 8 km and does not resolve the channels. The chop figure is an estimate.

**Not for navigation.**

## More

- `CLAUDE.md`: how the code is laid out, and the rules it follows.
- `docs/ipad-plan.md`: the next step.
- `NOTICE.md`: third-party material and licenses.
