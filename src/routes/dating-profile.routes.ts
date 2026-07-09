import { Router } from 'express';
import { datingProfileController } from '../Modules/profile-managemnt/dating-profile-controller';

const router = Router();
// Profile retrieval
router.get('/dating-profile/me', datingProfileController.getCompleteProfile);

// Core Data Synchronization Hooks
router.post('/dating-profile/basic-info', datingProfileController.syncBasicInfo);
router.put('/dating-profile/basic-info', datingProfileController.syncBasicInfo);

router.post('/dating-profile/education-career', datingProfileController.syncEducationCareer);
router.put('/dating-profile/education-career', datingProfileController.syncEducationCareer);

router.post('/dating-profile/cultural-background', datingProfileController.syncCulturalBackground);
router.put('/dating-profile/cultural-background', datingProfileController.syncCulturalBackground);

router.post('/dating-profile/relationship-goals', datingProfileController.syncRelationshipGoals);
router.put('/dating-profile/relationship-goals', datingProfileController.syncRelationshipGoals);

router.post('/dating-profile/photos', datingProfileController.syncPhotos);
router.put('/dating-profile/photos', datingProfileController.syncPhotos);