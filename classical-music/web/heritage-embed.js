document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && window.parent !== window) {
    window.parent.postMessage({ type: 'heritage-hall-close' }, location.origin);
  }
});
window.addEventListener('error', () => {
  const loader = document.querySelector('#loader');
  if (loader && !loader.classList.contains('hide')) {
    document.querySelector('#loader-text').textContent = '三维场景未能加载，可返回书房继续试听。';
  }
});
