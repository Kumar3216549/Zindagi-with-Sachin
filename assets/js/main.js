// Zindagi with Sachin — shared site script
// Handles the mobile nav toggle and highlights the current page's nav link.

document.addEventListener('DOMContentLoaded', function () {
  var toggleBtn = document.getElementById('menuToggle');
  var navLinks = document.getElementById('navLinks');

  if (toggleBtn && navLinks) {
    toggleBtn.addEventListener('click', function () {
      var isOpen = navLinks.classList.toggle('show');
      toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  // Mark the current page's nav link as active
  var currentPage = window.location.pathname.split('/').pop() || 'index.html';
  var links = document.querySelectorAll('.nav-links a');
  links.forEach(function (link) {
    var href = link.getAttribute('href');
    if (href === currentPage) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
});
