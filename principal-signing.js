(() => {
  'use strict';
  const dialog = document.querySelector('#seal-dialog');
  if (!dialog) return;
  const $ = selector => dialog.querySelector(selector);
  const sheet = $('#seal-sheet'), canvas = $('#seal-canvas');
  const labels = {signature:'Tanda tangan',stamp:'Stempel'};
  let bridge, snapshot, sourceBytes, preparedBytes, sourceHash, assets = {}, boxes = [];
  let pdfjs, sourceDocument, finalDocument, readySigned = null, selected = 'signature', pageNumber = 1;
  let loading = false, rendering = false, publishing = false, finalMode = false, invalid = false;
  let epoch = 0, renderId = 0, renderTask, controller, dependencies;
  let loadStage = '';
  const views = {};
  const recordKey = record => JSON.stringify(record ? [record.code,record.letterPath,record.updatedAt,record.status] : null);
  const eligible = record => bridge?.getMode() === 'principal' && record?.status === 'Menunggu persetujuan Kepala Sekolah' && record?.letterPath;
  const stale = () => invalid || !eligible(bridge?.getRecord()) || recordKey(bridge.getRecord()) !== recordKey(snapshot);
  const selectedBox = () => boxes.find(box=>box.kind===selected);
  const message = text => { $('#seal-message').textContent=text; };
  const networkFailure = error => ['TypeError','NetworkError','TimeoutError'].includes(error?.name) || /network|fetch|connection|load failed/i.test(error?.message || '');
  const readableError = (error, fallback) => networkFailure(error) ? fallback : error.message || fallback;
  function controls() {
    const busy = loading || rendering || publishing;
    for (const element of dialog.querySelectorAll('[data-seal-edit]')) element.disabled = busy || finalMode || stale();
    $('#seal-build').disabled = busy || !sourceDocument || finalMode || stale();
    $('#seal-edit').disabled = busy || !finalMode || stale();
    $('#seal-close').disabled = publishing;
    $('#seal-retry').hidden = !invalid;
    $('#seal-retry').disabled = busy;
    $('#seal-review').disabled = busy || !readySigned || !finalMode || stale();
    $('#seal-publish').disabled = busy || !readySigned || !finalMode || !$('#seal-review').checked || stale();
    $('#seal-page').disabled = busy || !sourceDocument;
    $('#seal-zoom').disabled = busy || !sourceDocument;
    $('#seal-prev').disabled = busy || pageNumber<=1;
    $('#seal-next').disabled = busy || !sourceDocument || pageNumber>=sourceDocument.numPages;
  }
  async function libraries() {
    if (!dependencies) dependencies = Promise.all([
      import('./assets/vendor/pdf.min.js').catch(async error=> {
        if(!networkFailure(error))throw error;
        // A failed module download is cached by the browser; use a fresh URL once.
        return import(`./assets/vendor/pdf.min.js?retry=${Date.now()}`);
      }),
      window.PDFLib ? Promise.resolve() : new Promise((resolve,reject)=> {
        const script=document.createElement('script'); script.src='assets/vendor/pdf-lib.min.js';
        script.onload=resolve; script.onerror=()=> {script.remove();reject(new Error('Perangkat pembaca PDF belum dapat dimuat. Tutup lalu coba kembali.'));}; document.head.append(script);
      })
    ]).then(([module])=> {module.GlobalWorkerOptions.workerSrc=new URL('assets/vendor/pdf.worker.min.js',window.location.href).href;return module;}).catch(error=> {dependencies=null;throw error;});
    return dependencies;
  }
  async function pdfDocument(bytes) {
    const options=()=>({data:bytes.slice(),cMapUrl:new URL('assets/vendor/pdfjs/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('assets/vendor/pdfjs/standard_fonts/',location.href).href,wasmUrl:new URL('assets/vendor/pdfjs/wasm/',location.href).href,isEvalSupported:false});
    const task=pdfjs.getDocument(options());
    try {return await task.promise;}
    catch(error) {
      await task.destroy().catch(()=>{});
      if(!networkFailure(error) && !/worker/i.test(error.message || ''))throw error;
      // Some browser policies reject module workers. Keep rendering locally with PDF.js's own fallback.
      globalThis.pdfjsWorker=await import('./assets/vendor/pdf.worker.min.js?local-fallback=1');
      // Use a fresh PDFWorker class: a failed worker import remains cached in the original instance.
      pdfjs=await import('./assets/vendor/pdf.min.js?local-fallback=1');
      return pdfjs.getDocument(options()).promise;
    }
  }
  function disposeDocument(document) {
    if (!document) return;
    if (document.loadingTask?.destroy) document.loadingTask.destroy().catch(()=>{});
    else if (document.cleanup) document.cleanup().catch(()=>{});
  }
  async function viewport(page) {
    if (!views[page]) {
      const sourcePage=await sourceDocument.getPage(page), view=sourcePage.getViewport({scale:1});
      views[page]={width:view.width,height:view.height,transform:[...view.transform]};
    }
    return views[page];
  }
  function constrain(box) {
    const view=views[box.page]; if (!view) return;
    box.width=Math.max(.04,Math.min(.75,box.width));
    box.height=box.width*view.width/(assets[box.kind].aspect*view.height);
    if (box.height>.85) {box.height=.85;box.width=box.height*view.height*assets[box.kind].aspect/view.width;}
    box.x=Math.max(0,Math.min(1-box.width,box.x)); box.y=Math.max(0,Math.min(1-box.height,box.y));
  }
  function overlays() {
    for (const box of boxes) {
      const layer=sheet.querySelector(`[data-kind="${box.kind}"]`);
      layer.hidden=finalMode || box.page!==pageNumber;
      layer.classList.toggle('selected',box.kind===selected);
      layer.style.left=`${box.x*100}%`;layer.style.top=`${box.y*100}%`;layer.style.width=`${box.width*100}%`;layer.style.height=`${box.height*100}%`;
      layer.setAttribute('aria-label',`${labels[box.kind]} pada halaman ${box.page}. Geser atau gunakan tombol panah untuk memindahkan.`);
    }
    const box=selectedBox();
    if (box) {
      $('#seal-x').value=box.x*100;$('#seal-y').value=box.y*100;$('#seal-width').value=box.width*100;
      $('#seal-x-value').textContent=`${(box.x*100).toFixed(1)}%`;$('#seal-y-value').textContent=`${(box.y*100).toFixed(1)}%`;$('#seal-width-value').textContent=`${(box.width*100).toFixed(1)}%`;
      $('#seal-target-page').value=String(box.page);
    }
    for (const button of dialog.querySelectorAll('[data-seal-kind]')) button.setAttribute('aria-pressed',String(button.dataset.sealKind===selected));
  }
  async function render() {
    const token=++renderId, session=epoch;
    rendering=true; controls(); renderTask?.cancel();
    try {
      const document=finalMode ? finalDocument : sourceDocument;
      const page=await document.getPage(pageNumber);
      await viewport(pageNumber);
      if (token!==renderId || session!==epoch) return;
      const base=page.getViewport({scale:1});
      const fitPage=$('#seal-zoom').value==='page' && window.innerWidth>850;
      const displayWidth=Math.min(800,sheet.parentElement.clientWidth || 680,fitPage ? Math.max(300,window.innerHeight-420)*base.width/base.height : Infinity);
      sheet.style.maxWidth=`${displayWidth}px`;
      const pixelScale=Math.min(displayWidth/base.width*Math.min(window.devicePixelRatio || 1,2),Math.sqrt(8000000/(base.width*base.height)));
      const visible=page.getViewport({scale:pixelScale});
      canvas.width=Math.ceil(visible.width);canvas.height=Math.ceil(visible.height);
      renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport:visible,background:'#fff'});
      await renderTask.promise;
      if (token!==renderId || session!==epoch) return;
      $('#seal-loading').hidden=true;sheet.hidden=false;sheet.classList.toggle('is-final',finalMode);
      $('#seal-page').value=String(pageNumber);$('#seal-page-count').textContent=`${sourceDocument.numPages} halaman · ${finalMode ? 'Pratinjau hasil pengesahan' : 'Geser aset di atas surat'}`;
      overlays();
    } catch (error) {if (token===renderId && session===epoch && error.name!=='RenderingCancelledException') {invalid=true;readySigned=null;message(readableError(error,'Koneksi pembaca PDF terputus. Tutup pengesahan lalu buka kembali untuk memuat ulang surat.'));}}
    finally {if (token===renderId && session===epoch) {rendering=false;controls();}}
  }
  async function fetchBytes(url, label) {
    const signal=controller.signal;
    for(let attempt=0;attempt<3;attempt++) {
      try {
        signal.throwIfAborted();
        const response=await fetch(`${url}&format=base64`,{cache:'no-store',credentials:'same-origin',signal});
        if (!response.ok) {
          if ([408,429,502,503,504].includes(response.status) && attempt<2) {await response.body?.cancel();continue;}
          let text=`${label} belum dapat dimuat.`;try{text=(await response.json()).error || text;}catch{}
          throw new Error(text);
        }
        const data=await response.json();
        if(typeof data.base64!=='string')throw new Error(`Data ${label.toLowerCase()} tidak valid. Muat ulang pengesahan.`);
        const binary=atob(data.base64),bytes=new Uint8Array(binary.length);
        for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
        return bytes;
      } catch(error) {
        if(signal.aborted || !networkFailure(error) || attempt===2) throw error;
      }
      await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
    }
  }
  async function asset(kind) {
    const bytes=await fetchBytes(`/api/admin/signing-asset?kind=${kind}`,labels[kind]),url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
    const image=new Image();image.src=url;
    try {await image.decode();}catch(error){URL.revokeObjectURL(url);throw error;}
    return {bytes,url,aspect:image.naturalWidth/image.naturalHeight};
  }
  async function open() {
    const record=bridge.getRecord();if (!eligible(record) || bridge.isBusy()) return;
    cleanup();const session=++epoch;snapshot={...record};invalid=false;loading=true;pageNumber=1;selected='signature';finalMode=false;readySigned=null;
    controller=new AbortController();const activeController=controller;
    $('#seal-review').checked=false;$('#seal-loading').hidden=false;$('#seal-loading').textContent='Memuat surat, tanda tangan, dan stempel…';sheet.hidden=true;
    $('#seal-principal-name').textContent=window.AmanahSchool.principalName;
    $('#seal-request').textContent=`${record.student} · ${record.code}`;
    message('Atur posisi dan ukuran kedua aset, lalu periksa pratinjau hasil sebelum menerbitkan surat.');
    if(!dialog.open)dialog.showModal();controls();
    const timeout=setTimeout(()=>activeController.abort(),60000);
    try {
      loadStage='pembaca PDF';$('#seal-loading').textContent='Menyiapkan pembaca PDF…';
      const module=await libraries();
      if(session!==epoch || !dialog.open)return;
      loadStage='berkas surat';$('#seal-loading').textContent='Memuat berkas surat…';
      const bytes=await fetchBytes(`/api/admin/document?code=${encodeURIComponent(record.code)}&kind=letter`,'Berkas surat');
      if(session!==epoch || !dialog.open)return;
      // Load private files one at a time: the hosting service handles one request per instance.
      for(const kind of ['signature','stamp']) {
        loadStage=labels[kind].toLowerCase();$('#seal-loading').textContent=`Memuat ${loadStage}…`;
        const item=await asset(kind);
        if(session!==epoch || !dialog.open){URL.revokeObjectURL(item.url);return;}
        assets[kind]=item;
      }
      pdfjs=module;sourceBytes=bytes;
      sourceHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
      const mime=bytes[0]===37 && bytes[1]===80 ? 'application/pdf' : bytes[0]===137 ? 'image/png' : 'image/jpeg';
      loadStage='pratinjau PDF';$('#seal-loading').textContent='Menampilkan halaman surat…';
      preparedBytes=await window.AmanahSealPdf.prepare(bytes,mime);
      sourceDocument=await pdfDocument(preparedBytes);
      if (session!==epoch || !dialog.open) return;
      pageNumber=sourceDocument.numPages;
      const options=Array.from({length:sourceDocument.numPages},(_,index)=>new Option(`Halaman ${index+1}`,String(index+1)));
      $('#seal-page').replaceChildren(...options);$('#seal-target-page').replaceChildren(...options.map(option=>option.cloneNode(true)));
      await viewport(pageNumber);
      boxes=[{kind:'signature',page:pageNumber,x:.56,y:.735,width:.22},{kind:'stamp',page:pageNumber,x:.48,y:.735,width:.17}];
      for (const box of boxes) {constrain(box);sheet.querySelector(`[data-kind="${box.kind}"] img`).src=assets[box.kind].url;}
      loading=false;await render();
    } catch (error) {if(session===epoch){invalid=true;activeController.abort();$('#seal-loading').textContent=`Gagal memuat ${loadStage}. Klik Muat ulang pratinjau.`;message(error.name==='AbortError' ? `Pemuatan ${loadStage} melewati batas waktu. Coba muat ulang pratinjau.` : readableError(error,`Koneksi saat memuat ${loadStage} terputus. Klik Muat ulang pratinjau. Surat belum diterbitkan.`));}}
    finally {clearTimeout(timeout);if(session===epoch){loading=false;controls();}}
  }
  function cleanup() {
    epoch++;renderId++;controller?.abort();renderTask?.cancel();
    disposeDocument(sourceDocument);disposeDocument(finalDocument);
    sourceDocument=null;finalDocument=null;sourceBytes=null;preparedBytes=null;readySigned=null;boxes=[];
    for (const item of Object.values(assets)) URL.revokeObjectURL(item.url);assets={};
    for (const key of Object.keys(views)) delete views[key];
    for (const image of sheet.querySelectorAll('.seal-layer img')) image.removeAttribute('src');
  }
  for (const layer of sheet.querySelectorAll('.seal-layer')) {
    layer.addEventListener('pointerdown',event=> {
      if (loading || rendering || publishing || finalMode || stale()) return;
      selected=layer.dataset.kind;overlays();const box=selectedBox(),rect=sheet.getBoundingClientRect(),start={x:event.clientX,y:event.clientY,bx:box.x,by:box.y};
      layer.setPointerCapture(event.pointerId);event.preventDefault();
      const move=moveEvent=> {box.x=start.bx+(moveEvent.clientX-start.x)/rect.width;box.y=start.by+(moveEvent.clientY-start.y)/rect.height;constrain(box);overlays();};
      const end=()=> {layer.removeEventListener('pointermove',move);layer.removeEventListener('pointerup',end);layer.removeEventListener('pointercancel',end);};
      layer.addEventListener('pointermove',move);layer.addEventListener('pointerup',end);layer.addEventListener('pointercancel',end);
    });
    layer.addEventListener('keydown',event=> {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) || finalMode || stale() || loading || rendering || publishing) return;
      event.preventDefault();selected=layer.dataset.kind;const box=selectedBox(),step=event.shiftKey ? .02 : .005;
      if(event.key==='ArrowLeft')box.x-=step;if(event.key==='ArrowRight')box.x+=step;if(event.key==='ArrowUp')box.y-=step;if(event.key==='ArrowDown')box.y+=step;
      constrain(box);overlays();
    });
  }
  for (const button of dialog.querySelectorAll('[data-seal-kind]')) button.addEventListener('click',async()=> {selected=button.dataset.sealKind;const box=selectedBox();if(box.page!==pageNumber){pageNumber=box.page;await render();}else overlays();});
  for (const axis of ['x','y','width']) $(`#seal-${axis}`).addEventListener('input',()=> {const box=selectedBox();if(!box || finalMode || stale())return;box[axis]=Number($(`#seal-${axis}`).value)/100;constrain(box);overlays();});
  $('#seal-target-page').addEventListener('change',async()=> {const box=selectedBox();box.page=Number($('#seal-target-page').value);await viewport(box.page);constrain(box);pageNumber=box.page;await render();});
  $('#seal-page').addEventListener('change',async()=> {pageNumber=Number($('#seal-page').value);await render();});
  $('#seal-zoom').addEventListener('change',render);
  $('#seal-prev').addEventListener('click',async()=> {if(pageNumber>1){pageNumber--;await render();}});
  $('#seal-next').addEventListener('click',async()=> {if(pageNumber<sourceDocument.numPages){pageNumber++;await render();}});
  $('#seal-reset').addEventListener('click',()=> {const box=selectedBox();box.x=box.kind==='signature' ? .56 : .48;box.y=.735;box.width=box.kind==='signature' ? .22 : .17;constrain(box);overlays();});
  $('#seal-build').addEventListener('click',async()=> {
    if(loading || rendering || publishing || stale() || finalMode)return;
    const session=epoch;loading=true;$('#seal-review').checked=false;controls();message('Membuat pratinjau hasil pengesahan…');
    try {
      for(const box of boxes)await viewport(box.page);
      readySigned=await window.AmanahSealPdf.stamp(preparedBytes,boxes,{signature:assets.signature.bytes,stamp:assets.stamp.bytes},views);
      if(readySigned.length>10*1024*1024)throw new Error('Hasil PDF melebihi 10 MB. Gunakan surat sumber yang lebih kecil.');
      finalDocument=await pdfDocument(readySigned);if(session!==epoch)return;
      finalMode=true;loading=false;await render();
      message('Periksa hasil pada semua halaman yang diperlukan. Centang konfirmasi untuk menyetujui dan menerbitkan surat.');
    }catch(error){if(session===epoch){readySigned=null;message(readableError(error,'Koneksi saat menyiapkan pembaca PDF terputus. Tutup pengesahan lalu buka kembali. Surat belum diterbitkan.'));}}
    finally{if(session===epoch){loading=false;controls();}}
  });
  $('#seal-edit').addEventListener('click',async()=> {if(loading || rendering || publishing)return;finalMode=false;readySigned=null;$('#seal-review').checked=false;disposeDocument(finalDocument);finalDocument=null;message('Ubah posisi lalu buat ulang pratinjau hasil.');await render();});
  $('#seal-review').addEventListener('change',controls);
  $('#seal-publish').addEventListener('click',async()=> {
    if(loading || rendering || publishing || !readySigned || !finalMode || !$('#seal-review').checked || stale() || bridge.isBusy())return;
    publishing=true;controls();message('Menyimpan surat yang disahkan dan menerbitkannya untuk pemohon…');
    try {
      const file=new File([readySigned],`Surat-Disahkan-${snapshot.code}.pdf`,{type:'application/pdf'});
      const authorization={sourceLetterPath:snapshot.letterPath,sourceSha256:sourceHash,pageCount:sourceDocument.numPages,placements:boxes.map(box=>({...box}))};
      const success=await bridge.publish(file,snapshot.code,authorization);
      if(!success)throw new Error(document.querySelector('#action-message').textContent || 'Surat belum diterbitkan. Coba kembali.');
      dialog.close();
    }catch(error){message(error.message || 'Pengesahan belum tersimpan. Coba kembali.');}
    finally{publishing=false;controls();}
  });
  document.querySelector('#open-seal').addEventListener('click',open);
  $('#seal-close').addEventListener('click',()=> {if(!publishing)dialog.close();});
  $('#seal-retry').addEventListener('click',()=> {if(!loading && !rendering && !publishing)open();});
  dialog.addEventListener('cancel',event=> {if(publishing)event.preventDefault();});
  dialog.addEventListener('close',cleanup);
  window.AmanahPrincipalSigning={configure(options){bridge=options;},open,update(record){
    document.querySelector('#seal-launch').hidden=!eligible(record);
    if(dialog.open && !publishing && !loading && stale()){invalid=true;readySigned=null;$('#seal-review').checked=false;message('Surat atau status berubah. Tutup pengesahan lalu buka kembali dari surat terbaru.');controls();}
  }};
})();
