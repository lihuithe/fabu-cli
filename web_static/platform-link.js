(function preserveOriginalCovers(){
  if(typeof inspectCover==='function'){
    inspectCover=function(input){
      const card=input.closest('.cover-card'),file=input.files[0],preview=card.querySelector('.ratio-preview'),choose=card.querySelector('.choose-cover'),remove=card.querySelector('.remove-cover');
      if(card.dataset.previewUrl){URL.revokeObjectURL(card.dataset.previewUrl);delete card.dataset.previewUrl}
      card.classList.toggle('has-file',Boolean(file));card.classList.remove('ratio-warning');
      if(remove)remove.hidden=!file;
      if(!file){preview.style.backgroundImage='';preview.classList.remove('has-preview');choose.textContent='选择图片';card.removeAttribute('title');return}
      const url=URL.createObjectURL(file),image=new Image();
      card.dataset.previewUrl=url;
      preview.style.backgroundImage=`url(${url})`;preview.classList.add('has-preview');
      image.onload=()=>{
        if(card.dataset.previewUrl!==url)return;
        const expected=RATIO_VALUES[card.dataset.ratio],actual=image.naturalWidth/image.naturalHeight,mismatch=Math.abs(actual-expected)/expected>0.02;
        card.classList.toggle('ratio-warning',mismatch);
        choose.innerHTML=`重新选择<small>${image.naturalWidth}×${image.naturalHeight}<br>${mismatch?'请确认原图比例':'保持原图上传'}</small>`;
        card.title=mismatch?`原图比例与 ${card.dataset.ratio} 不一致，软件不会裁切，请自行确认`:'软件保持原始尺寸和格式上传';
      };
      image.onerror=()=>{if(card.dataset.previewUrl!==url)return;card.classList.add('ratio-warning');choose.innerHTML='重新选择<small>无法读取图片尺寸</small>'};
      image.src=url;
    };
  }
  if(typeof window.showToast==='function'){
    const originalShowToast=window.showToast;
    window.showToast=function(message,type){
      if(message==='封面规格检查通过，正在打开 Chrome')message='原始封面已保留，正在打开 Chrome';
      return originalShowToast(message,type);
    };
  }
})();

(function configurePlatformRules(){
  const ratioCard=document.querySelector('.cover-card[data-ratio="3:4"]');
  if(ratioCard&&!selectedPlatforms().length)ratioCard.querySelector('.cover-use').textContent='用于：抖音、快手、视频号';
  updateCovers();
})();

(function enableMultipleTopics(){
  const topicInput=document.getElementById('topics'),publishForm=document.getElementById('publishForm');
  if(!topicInput||!publishForm)return;
  topicInput.placeholder='#话题一 #话题二，或使用逗号、空格、换行分隔';
  topicInput.title='支持多个话题：#美食 #探店，或 美食,探店';
  if(!document.querySelector('.topic-separator-hint')){
    const hint=document.createElement('small');
    hint.className='topic-separator-hint';
    hint.textContent='多个话题请用空格、逗号、中文逗号或换行分开，例如：#美食 #探店 #旅行';
    Object.assign(hint.style,{display:'block',marginTop:'6px',color:'#8b91a0',fontSize:'10px',lineHeight:'1.5'});
    topicInput.insertAdjacentElement('afterend',hint);
  }
  publishForm.addEventListener('submit',()=>{
    const tags=topicInput.value.split(/[#，,、；;|｜/／\\\s]+/u).map(item=>item.trim()).filter(Boolean);
    topicInput.value=tags.join(',');
  },true);
})();
