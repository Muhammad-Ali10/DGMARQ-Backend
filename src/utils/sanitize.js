/**
 * Sanitize HTML and prevent script injection
 * Removes potentially dangerous HTML tags and attributes
 */
export const sanitizeText = (text) => {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Remove HTML tags
  let sanitized = text.replace(/<[^>]*>/g, '');
  
  // Remove script tags and their content
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, '');
  
  // Remove on* event handlers
  sanitized = sanitized.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  return sanitized;
};

/**
 * Validate SEO title length
 */
export const validateMetaTitle = (title) => {
  if (!title) return { valid: true, value: null };
  
  if (typeof title !== 'string') {
    return { valid: false, error: 'Meta title must be a string' };
  }
  
  const sanitized = sanitizeText(title);
  
  if (sanitized.length > 60) {
    return { 
      valid: false, 
      error: 'Meta title must be 60 characters or less (recommended for SEO)' 
    };
  }
  
  return { valid: true, value: sanitized };
};

/**
 * Validate SEO description length
 */
export const validateMetaDescription = (description) => {
  if (!description) return { valid: true, value: null };
  
  if (typeof description !== 'string') {
    return { valid: false, error: 'Meta description must be a string' };
  }
  
  const sanitized = sanitizeText(description);
  
  if (sanitized.length > 160) {
    return { 
      valid: false, 
      error: 'Meta description must be 160 characters or less (recommended for SEO)' 
    };
  }
  
  return { valid: true, value: sanitized };
};

