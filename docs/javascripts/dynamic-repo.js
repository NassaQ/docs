/**
 * Dynamically changes the GitHub repository link in the header
 * based on the current page path.
 */
document.addEventListener("DOMContentLoaded", function() {
    // Also hook into MkDocs Material instant loading (navigation.instant)
    if (typeof document$.subscribe === "function") {
        document$.subscribe(function() {
            updateRepoLink();
        });
    } else {
        updateRepoLink();
    }
});

function updateRepoLink() {
    const repoLinks = document.querySelectorAll('.md-header__source .md-source, .md-source');
    if (!repoLinks.length) return;

    const currentPath = window.location.pathname;
    
    let repoName = "NassaQ";
    let repoUrl = "https://github.com/NassaQ";
    let tooltip = "Go to organization";

    // Route logic based on current path
    if (currentPath.includes('/backend/') || currentPath.includes('/api-endpoints/')) {
        repoName = "NassaQ / server";
        repoUrl = "https://github.com/NassaQ/server";
        tooltip = "Go to backend repository";
    } else if (currentPath.includes('/frontend')) {
        repoName = "NassaQ / user_interface";
        repoUrl = "https://github.com/NassaQ/user_interface";
        tooltip = "Go to frontend repository";
    } else if (currentPath.includes('/ocr-worker/') || currentPath.includes('/ocr-pipelines/')) {
        repoName = "NassaQ / ocr-api";
        repoUrl = "https://github.com/NassaQ/ocr-api";
        tooltip = "Go to OCR repository";
    }

    // Apply to all matched links (header and mobile sidebar)
    repoLinks.forEach(link => {
        link.href = repoUrl;
        link.title = tooltip;
        
        // Find the text container inside the source link and update it
        const repoNameContainer = link.querySelector('.md-source__repository');
        if (repoNameContainer) {
            // Check if the theme uses a specific inner wrapper or just text
            if (repoNameContainer.children.length === 0) {
                // If it's just raw text, replace it but keep whitespace formatting clean
                repoNameContainer.textContent = repoName;
            } else {
                // For safety if theme structure changes
                const textNode = Array.from(repoNameContainer.childNodes)
                    .find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0);
                if (textNode) {
                    textNode.textContent = repoName;
                } else {
                    repoNameContainer.textContent = repoName;
                }
            }
        }
    });
}
