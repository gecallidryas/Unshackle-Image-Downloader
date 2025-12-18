(function attachHKComicInfoGenerator(root) {
  function ComicInfoGenerator() {}

  ComicInfoGenerator.prototype.createComicInfoXML = function createComicInfoXML(series, title, pagesCount) {
    const safeSeries = this.escapeXML(String(series ?? ""));
    const safeTitle = this.escapeXML(String(title ?? ""));
    return `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <Title>${safeTitle}</Title>
    <Series>${safeSeries}</Series>
    <PageCount>${pagesCount}</PageCount>
</ComicInfo>`;
  };

  ComicInfoGenerator.prototype.escapeXML = function escapeXML(str) {
    const symbols = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;"
    };
    return str.replace(/[<>&'"]/g, (c) => symbols[c]);
  };

  root.HKComicInfoGenerator = new ComicInfoGenerator();
})(typeof self !== "undefined" ? self : globalThis);
