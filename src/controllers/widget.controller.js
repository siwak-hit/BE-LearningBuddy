const widgetModel = require('../models/widget.model');
const response = require('../utils/response');
const generateApiKey = require('../utils/generate-api-key');
const widgetLoaderService = require('../services/widget/widget-loader.service');
const externalLoaderService = require('../services/widget/external-loader.service');

const widgetController = {
  async create(req, res) {
    const {
      project_id,
      mode = 'floating',
      theme = {},
      position = 'bottom-right',
      allowed_origin = [],
      read_dom_context = true,
      is_active = true
    } = req.body;

    if (!project_id) {
      return response.error(res, 'project_id wajib diisi', null, 400);
    }

    const widgetConfig = await widgetModel.create({
      project_id,
      project_key: generateApiKey.projectKey('alb'),
      mode,
      theme,
      position,
      allowed_origin,
      read_dom_context,
      is_active
    });

    return response.success(
      res,
      'Widget config berhasil dibuat',
      widgetConfig,
      201
    );
  },

  async getByProjectKey(req, res) {
    const { projectKey } = req.params;

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

    const widgetConfig = await widgetModel.findByProjectKey(projectKey);

    return response.success(
      res,
      'Config widget berhasil diambil',
      widgetConfig
    );
  },

  async update(req, res) {
    const widgetConfig = await widgetModel.update(req.params.id, req.body);

    return response.success(
      res,
      'Widget config berhasil diperbarui',
      widgetConfig
    );
  },

  async getLoaderScript(req, res) {
    const script = widgetLoaderService.generate();

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.send(script);
  },

  async getExternalLoaderScript(req, res) {
    const script = externalLoaderService.generate();

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.send(script);
  }
};

module.exports = widgetController;
