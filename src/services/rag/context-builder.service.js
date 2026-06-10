const contextBuilderService = {
    build(retrievalResults) {
      if (!retrievalResults || retrievalResults.length === 0) {
        return 'Tidak ada konteks spesifik yang ditemukan.';
      }

      return retrievalResults.map(res => {
        const titlePart = res.title ? `${res.title}` : '';
        const topicPart = res.topic && res.topic !== res.title ? ` - ${res.topic}` : '';
        return `[${res.source_type}] ${titlePart}${topicPart}\n${res.content}\n`;
      }).join('\n');
    }
  };

  module.exports = contextBuilderService;
