(function attachHKEbookGenerator(root) {
  if (root.HKEbookGenerator) {
    return;
  }

  function EbookGenerator() {}

  EbookGenerator.prototype.createMimetype = function createMimetype() {
    return "application/epub+zip";
  };

  EbookGenerator.prototype.createContainerXML = function createContainerXML() {
    return `<?xml version="1.0" encoding="UTF-8" ?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    </rootfiles>
</container>
`;
  };

  EbookGenerator.prototype.createStyleCSS = function createStyleCSS() {
    return `img {
    max-height: 100%;
    max-width: 100%;
}
`;
  };

  EbookGenerator.prototype.createPageXHTML = function createPageXHTML(pageName) {
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <link href="../css/style.css" rel="stylesheet" type="text/css"/>
    <title>${pageName}</title>
</head>
<body>
    <div>
        <img alt="${pageName}" src="../img/${pageName}"/>
    </div>
</body>
</html>
`;
  };

  EbookGenerator.prototype.createContentOPF = function createContentOPF(uid, title, pages) {
    const manifestItems = pages.map((page, index) => {
      return `        <item id="IMG_${index}" href="img/${page.img}" media-type="${page.mime}"/>
        <item id="XHTML_${index}" href="xhtml/${page.xhtml}" media-type="application/xhtml+xml"/>`;
    }).join("\n");
    const spineRefs = pages.map((_, index) => {
      return `        <itemref idref="XHTML_${index}"/>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="${uid}" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
        <dc:title>${title}</dc:title>
        <dc:language>en-UNDEFINED</dc:language>
        <dc:identifier id="${uid}" opf:scheme="UUID">${uid}</dc:identifier>
    </metadata>
    <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="style.css" href="css/style.css" media-type="text/css"/>
${manifestItems}
    </manifest>
    <spine toc="ncx">
${spineRefs}
    </spine>
</package>
`;
  };

  EbookGenerator.prototype.createTocNCX = function createTocNCX(uid, title, pages) {
    const navPoints = pages.map((page, index) => {
      const position = index + 1;
      return `        <navPoint id="TOC_${position}" playOrder="${position}">
            <navLabel>
                <text>Page ${position}</text>
            </navLabel>
            <content src="xhtml/${page.xhtml}"/>
        </navPoint>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head>
        <meta name="dtb:uid" content="${uid}"/>
    </head>
    <docTitle>
        <text>${title}</text>
    </docTitle>
    <navMap>
${navPoints}
    </navMap>
</ncx>
`;
  };

  root.HKEbookGenerator = new EbookGenerator();
})(typeof self !== "undefined" ? self : globalThis);
