const projectModel = require('../models/project.model');
const widgetModel = require('../models/widget.model');
const response = require('../utils/response');
const slugify = require('../utils/slugify');
const generateApiKey = require('../utils/generate-api-key');
const env = require('../config/env');

const projectController = {
  async create(req, res) {
    const {
      name,
      school_name,
      course_name,
      status = 'active'
    } = req.body;

    if (!name) {
      return response.error(res, 'Nama project wajib diisi', null, 400);
    }

    const slug = slugify(name);

    const project = await projectModel.create({
      name,
      slug,
      school_name,
      course_name,
      status
    });

    const widgetConfig = await widgetModel.create({
      project_id: project.id,
      project_key: generateApiKey.projectKey('alb'),
      mode: env.DEFAULT_WIDGET_MODE,
      theme: {
        primaryColor: '#16a34a',
        title: 'AI Learning Buddy',
        subtitle: 'Tanya materi atau panduan VClass'
      },
      position: env.DEFAULT_WIDGET_POSITION,
      allowed_origin: [],
      read_dom_context: true,
      is_active: true
    });

    return response.success(
      res,
      'Project berhasil dibuat',
      {
        project,
        widget_config: widgetConfig
      },
      201
    );
  },

  async findAll(req, res) {
    const projects = await projectModel.findAll();

    const formattedProjects = projects.map(p => {
      let pKey = null;

      if (Array.isArray(p.widget_configs) && p.widget_configs.length > 0) {
        pKey = p.widget_configs[0].project_key;
      } else if (p.widget_configs && p.widget_configs.project_key) {
        pKey = p.widget_configs.project_key;
      }

      delete p.widget_configs;

      return {
        ...p,
        project_key: pKey
      };
    });

    return response.success(res, 'Data project berhasil diambil', formattedProjects);
  },

  async findById(req, res) {
    const project = await projectModel.findById(req.params.id);
    return response.success(res, 'Detail project berhasil diambil', project);
  },

  async update(req, res) {
    const payload = { ...req.body };

    if (payload.name) {
      payload.slug = slugify(payload.name);
    }

    const project = await projectModel.update(req.params.id, payload);
    return response.success(res, 'Project berhasil diperbarui', project);
  },

  async delete(req, res) {
    const project = await projectModel.delete(req.params.id);
    return response.success(res, 'Project berhasil dihapus', project);
  }
};

module.exports = projectController;
