(() => {
  'use strict';
  const bounded = item => Number.isInteger(item.page) && item.page > 0 && ['signature','stamp'].includes(item.kind) && ['x','y','width','height'].every(key=>Number.isFinite(item[key])) && item.x>=0 && item.y>=0 && item.width>0 && item.height>0 && item.x+item.width<=1.000001 && item.y+item.height<=1.000001;
  function point(view, x, y) {
    const [a,b,c,d,e,f] = view.transform, determinant = a*d-b*c;
    if (!determinant) throw new Error('Orientasi halaman tidak dapat dibaca.');
    return {x:(d*(x-e)-c*(y-f))/determinant,y:(a*(y-f)-b*(x-e))/determinant};
  }
  window.AmanahSealPdf = {
    async prepare(bytes, mime) {
      const {PDFDocument} = window.PDFLib;
      if (mime === 'application/pdf') {
        const document = await PDFDocument.load(bytes);
        if (document.getPageCount()<1 || document.getPageCount()>300) throw new Error('Surat harus berisi 1–300 halaman.');
        return bytes.slice();
      }
      const document = await PDFDocument.create();
      const image = mime === 'image/png' ? await document.embedPng(bytes) : mime === 'image/jpeg' ? await document.embedJpg(bytes) : null;
      if (!image) throw new Error('Format surat harus PDF, JPG, atau PNG.');
      const page = document.addPage([595.28,841.89]);
      const scale = Math.min(595.28/image.width,841.89/image.height);
      page.drawImage(image,{x:(595.28-image.width*scale)/2,y:(841.89-image.height*scale)/2,width:image.width*scale,height:image.height*scale});
      return document.save();
    },
    async stamp(bytes, placements, assets, views) {
      if (placements.length!==2 || new Set(placements.map(item=>item.kind)).size!==2 || !placements.every(bounded)) throw new Error('Tempatkan kedua aset sepenuhnya di dalam kertas.');
      const {PDFDocument,degrees} = window.PDFLib;
      const document = await PDFDocument.load(bytes);
      for (const item of [...placements].sort((a,b)=>a.kind==='stamp' ? -1 : 1)) {
        const page = document.getPage(item.page-1), view = views[item.page];
        if (!page || !view) throw new Error('Halaman penempatan tidak tersedia.');
        const bottomLeft = point(view,item.x*view.width,(item.y+item.height)*view.height);
        const bottomRight = point(view,(item.x+item.width)*view.width,(item.y+item.height)*view.height);
        const topLeft = point(view,item.x*view.width,item.y*view.height);
        const image = await document.embedPng(assets[item.kind]);
        page.drawImage(image,{x:bottomLeft.x,y:bottomLeft.y,width:Math.hypot(bottomRight.x-bottomLeft.x,bottomRight.y-bottomLeft.y),height:Math.hypot(topLeft.x-bottomLeft.x,topLeft.y-bottomLeft.y),rotate:degrees(Math.atan2(bottomRight.y-bottomLeft.y,bottomRight.x-bottomLeft.x)*180/Math.PI)});
      }
      return document.save();
    }
  };
})();
