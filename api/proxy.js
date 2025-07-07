import express from "express";
import fetch from "node-fetch";
import { load } from "cheerio";
import NodeCache from "node-cache";

const app = express();
const cache = new NodeCache({ stdTTL: 300 });
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setHeader("X-Proxy-By", "AdBlockProxy");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src * 'unsafe-inline' data: blob:;"
  );
  next();
});

app.get("/proxy", async (req, res) => {
  const targetUrl = req.query.url;

  // Bloqueia apenas recursos suspeitos
  if (/ads\.|popup|doubleclick|tracking/.test(targetUrl)) {
    return res.status(204).end();
  }

  const cached = cache.get(targetUrl);
  if (cached) return res.send(cached);

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
      },
    });

    const contentType = response.headers.get("content-type");

    // Se for imagem, css, etc, apenas retorna
    if (!contentType?.includes("text/html")) {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.setHeader("Content-Type", contentType);
      return res.send(buffer);
    }

    const html = await response.text();
    const $ = load(html);
    const baseUrl = new URL(targetUrl).origin;

    // Remove scripts que abrem nova aba ou têm nomes suspeitos
    $("script").each((_, el) => {
      const scriptContent = $(el).html();
      if (
        scriptContent?.includes("window.open") ||
        scriptContent?.includes("target=_blank") ||
        scriptContent?.includes("popup")
      ) {
        $(el).remove();
      }
    });

    // Remove elementos de propaganda
    $(
      ".ads, .popup, .sponsored, .banner, [id*='ads'], [class*='ads']"
    ).remove();
    $("[onclick]").removeAttr("onclick");
    $("[target='_blank']").removeAttr("target");

    // REESCREVE APENAS LINKS CLIQUEÁVEIS (<a>)
    $("a[href]").each((_, el) => {
      const $el = $(el);
      const href = $el.attr("href");

      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;

      let newUrl = "";

      if (href.startsWith("//")) {
        newUrl = "https:" + href;
      } else if (href.startsWith("/")) {
        newUrl = baseUrl + href;
      } else if (!href.startsWith("http")) {
        newUrl = new URL(href, targetUrl).href;
      } else {
        newUrl = href;
      }

      $el.attr("href", `/proxy?url=${encodeURIComponent(newUrl)}`);
    });

    const cleaned = $.html();
    cache.set(targetUrl, cleaned);
    res.send(cleaned);
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao carregar a página.");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
});
