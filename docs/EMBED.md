# Open with TextSous

Let readers send any recipe on your site to TextSous for a Cook Along
timeline. Add one link per recipe page, pointing at the page's own canonical
URL:

```html
<a href="https://textsous.com/open?url=YOUR_RECIPE_URL&utm_source=open-textsous&utm_medium=embed">Open with TextSous</a>
```

Replace `YOUR_RECIPE_URL` with the URL-encoded address of the recipe page, for
example `https%3A%2F%2Fexample.com%2Fsoup`. Keep `utm_source=open-textsous`
and `utm_medium=embed` so TextSous can attribute embed traffic.

A button-styled variant:

```html
<a
  href="https://textsous.com/open?url=YOUR_RECIPE_URL&utm_source=open-textsous&utm_medium=embed"
  style="display: inline-block; padding: 0.6rem 1.1rem; background: #17603a; color: #fff; border-radius: 6px; text-decoration: none; font-weight: 600;"
>Open with TextSous</a>
```

How it works: `textsous.com/open` redirects to `https://open.textsous.com`,
keeping the query string, and the converter starts automatically from `?url=`.
The converted recipe stays private to the reader; the viewer always credits
your site and links back to the original page.
