import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as cdk from 'aws-cdk-lib';
import { AppContext, StackCommonProps, StackConfig } from '../config';
import { NetworkMode } from 'aws-cdk-lib/aws-ecs';

export class WebhookECS extends cdk.Stack {
  constructor(appContext: AppContext, stackConfig: any) {
    let newProps = WebhookECS.getStackCommonProps(appContext, stackConfig);
    super(appContext.cdkApp, stackConfig.Name, newProps);
    
    const vpc = new ec2.Vpc(this, 'MyVpc', { maxAzs: 2 });

    const cluster = new ecs.Cluster(this, 'Ec2Cluster', { vpc });
    cluster.addCapacity('DefaultAutoScalingGroup', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO)
    });

    // create a task definition with CloudWatch Logs
    const logging = new ecs.AwsLogDriver({ streamPrefix: "myapp" })

    const taskDef = new ecs.Ec2TaskDefinition(this, "MyTaskDefinition");
    taskDef.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memoryLimitMiB: 512,
      logging,
    })

    // Instantiate ECS Service with just cluster and image
    new ecs.Ec2Service(this, "Ec2Service", {
      cluster,
      taskDefinition: taskDef,
    });
  }

  private static getStackCommonProps(appContext: AppContext, stackConfig: StackConfig): StackCommonProps{
    let newProps = appContext.stackCommonProps;
    if (stackConfig.UpdateRegionName) {
        console.log(`[INFO] Region is updated: ${stackConfig.Name} ->> ${stackConfig.UpdateRegionName}`);
        newProps = {
            ...appContext.stackCommonProps,
            env: {
                region: stackConfig.UpdateRegionName,
                account: appContext.appConfig.Project.Account
            }
        };
    } else {
        // console.log('not update region')
    }

    return newProps;
}
}