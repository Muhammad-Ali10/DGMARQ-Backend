export const sanitizeText = (text) => {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let sanitized = text.replace(/<[^>]*>/g, '');
  
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  sanitized = sanitized.replace(/javascript:/gi, '');
  
  sanitized = sanitized.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
  
  sanitized = sanitized.trim();
  
  return sanitized;
};

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

